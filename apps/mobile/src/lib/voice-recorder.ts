/**
 * The native voice recorder (T-0154): recording with `expo-audio` and the
 * recorder messages the composer shows. Only imported by the composer/voice
 * bubble (and tests through the interfaces below), so Vitest never loads the
 * native modules uninvoked. Split out of `voice-native.ts` (T-1030).
 */

import { Effect, type Effect as EffectType } from 'effect';

export const MIC_DENIED_MESSAGE =
  'Zilar needs access to your microphone to record voice messages. You can allow it in Settings.';
export const MIC_FAILED_MESSAGE = 'Could not start recording. Try again.';
export const RECORD_TOO_LONG_MESSAGE = 'That recording is too long to send.';
export const RECORD_FAILED_MESSAGE = 'Could not save the recording, try again.';

/** One finished recording, ready for the store's voice pipeline. */
export interface FinishedRecording {
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
}

/** Result of one record attempt: a file, a cancel, or a user-facing error. */
export type RecordResult =
  | { status: 'recorded'; recording: FinishedRecording }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };
/** Records one voice message. Tests inject a fake; the app uses expo-audio. */
export interface VoiceRecorderPort {
  /** Starts a recording. Rejects only on misuse, never on denial. */
  start(): Promise<{ status: 'started' } | { status: 'error'; message: string }>;
  /** Stops and returns the file, or a cancel/error (too short, too long). */
  stop(): Promise<RecordResult>;
  /** Discards the recording without returning a file. */
  cancel(): Promise<void>;
  /** Live duration in ms while recording, for the timer row. */
  currentDurationMs(): number;
  /** Live input level 0..1 while recording (0 when unknown), for the waveform. */
  currentLevel(): number;
  /** True while the recorder holds the microphone. */
  isRecording(): boolean;
}

/** The native recorder shape `createVoiceRecorder` drives (test seam). */
export interface NativeRecorderShape {
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  uri: string | null;
  isRecording: boolean;
  currentTime: number;
  /** The recorder status; `metering` is the input level in dB (about -160..0). */
  getStatus?: () => { metering?: number | undefined };
}

/** The expo-audio pieces the recorder needs (test seam). */
export interface RecordingAudio {
  requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
  AudioRecorder: new (options: unknown) => NativeRecorderShape;
  HIGH_QUALITY?: unknown;
}

type AudioMode = { playsInSilentMode: boolean; allowsRecording: boolean };
type StartResult = { status: 'started' } | { status: 'error'; message: string };

/**
 * The options handed to the native recorder. `RecordingPresets.HIGH_QUALITY`
 * keeps the platform codec settings under `ios` and `android`; expo-audio's
 * own `useAudioRecorder` flattens them before the native call, and
 * `AudioModule.AudioRecorder` does NOT. Passing the raw preset left Android
 * without an output format or encoder, so it recorded with the system default
 * (3GP, AMR-NB: 8 kHz telephone quality, device test 2026-10-03). Here the
 * platform block is flattened in, and the recording is mono 48 kHz at 128 kbps
 * with metering on for the live waveform.
 */
export function buildRecordingOptions(preset: unknown, os: string): Record<string, unknown> {
  const source = (preset ?? {}) as { ios?: object; android?: object };
  const platform = os === 'ios' ? source.ios : os === 'android' ? source.android : undefined;
  return {
    extension: '.m4a',
    sampleRate: 48000,
    numberOfChannels: 1,
    bitRate: 128000,
    isMeteringEnabled: true,
    ...platform,
  };
}

/** The expo-audio pieces, loaded only when a recording starts (lazy). */
const loadExpoAudio: Effect.Effect<RecordingAudio, unknown> = Effect.tryPromise({
  try: () => import('expo-audio'),
  catch: (error: unknown) => error,
}).pipe(
  Effect.map((module) => ({
    requestRecordingPermissionsAsync: module.AudioModule.requestRecordingPermissionsAsync,
    AudioRecorder: module.AudioModule.AudioRecorder as new (
      options: unknown,
    ) => NativeRecorderShape,
    HIGH_QUALITY: module.RecordingPresets.HIGH_QUALITY as unknown,
  })),
);

/** The platform name for the recording options; 'unknown' when react-native is missing. */
const platformOs: Effect.Effect<string> = Effect.tryPromise({
  try: () => import('react-native'),
  catch: () => undefined,
}).pipe(
  Effect.map((module) => module.Platform.OS as string),
  Effect.orElseSucceed(() => 'unknown'),
);

/**
 * Switches the audio session mode. It is a nicety: a failure here never
 * blocks recording or playback, so every error is swallowed.
 */
const setAudioModeEffect = (
  setAudioMode: ((mode: AudioMode) => Promise<void>) | undefined,
  mode: AudioMode,
): Effect.Effect<void> =>
  (setAudioMode === undefined
    ? Effect.tryPromise({ try: () => import('expo-audio'), catch: () => undefined }).pipe(
        Effect.flatMap((module) =>
          Effect.tryPromise({
            try: () => module.setAudioModeAsync(mode),
            catch: () => undefined,
          }),
        ),
      )
    : Effect.tryPromise({ try: () => setAudioMode(mode), catch: () => undefined })
  ).pipe(Effect.orElseSucceed(() => undefined));

/** Creates the real recorder: permission first, `expo-audio` m4a second. */
export function createVoiceRecorder(deps?: {
  audio?: RecordingAudio;
  setAudioMode?: ((mode: AudioMode) => Promise<void>) | undefined;
  fileReader?: ((uri: string) => Promise<{ size: number | undefined }>) | undefined;
  platform?: string | undefined;
}): VoiceRecorderPort {
  let recorder: NativeRecorderShape | null = null;
  // Recording leaves the audio session in record mode, which makes playback
  // quiet and tinny on some phones: switch back once the mic is released.
  const restorePlaybackMode = setAudioModeEffect(deps?.setAudioMode, {
    playsInSilentMode: true,
    allowsRecording: false,
  });
  const recordMode = setAudioModeEffect(deps?.setAudioMode, {
    playsInSilentMode: true,
    allowsRecording: true,
  });

  // Everything that can throw — the native import, the permission request,
  // the recorder build — lands in one handled failure (finding 1, round 3):
  // see `start` below. A denial stays the denied copy.
  const startEffect = Effect.fnUntraced(function* (): EffectType.fn.Return<StartResult, unknown> {
    const audio = deps?.audio ?? (yield* loadExpoAudio);
    const permission = yield* Effect.promise(() => audio.requestRecordingPermissionsAsync());
    if (!permission.granted) {
      return { status: 'error', message: MIC_DENIED_MESSAGE };
    }
    yield* recordMode;
    // Mono 48 kHz AAC: a phone microphone is mono, so a stereo preset only
    // doubles the file; metering feeds the live waveform.
    const os = deps?.platform ?? (yield* platformOs);
    const fresh = new audio.AudioRecorder(buildRecordingOptions(audio.HIGH_QUALITY, os));
    yield* Effect.promise(() => fresh.prepareToRecordAsync());
    fresh.record();
    recorder = fresh;
    return { status: 'started' };
  });

  // A missing native module (pre-rebuild) is a mic-failed copy, never an
  // unhandled rejection; any other failure of the start is the same copy.
  const micFailed = (): StartResult => {
    recorder = null;
    return { status: 'error', message: MIC_FAILED_MESSAGE };
  };

  const stopEffect = Effect.fnUntraced(function* (
    current: NativeRecorderShape,
  ): EffectType.fn.Return<RecordResult> {
    const durationMs = Math.max(0, Math.round(current.currentTime * 1000));
    const uri = current.uri;
    const stopped = yield* Effect.tryPromise({
      try: () => current.stop(),
      catch: () => undefined,
    }).pipe(
      Effect.map(() => true),
      Effect.orElseSucceed(() => false),
    );
    yield* restorePlaybackMode;
    if (!stopped) {
      return { status: 'error', message: RECORD_FAILED_MESSAGE };
    }
    const settledUri = current.uri ?? uri;
    if (settledUri === null || settledUri === '') {
      return { status: 'error', message: RECORD_FAILED_MESSAGE };
    }
    // A size failure is "unknown", never "empty": only a real zero refuses
    // as `voice_empty` downstream (finding 3).
    const size = yield* readFileSize(settledUri, deps?.fileReader);
    if (size === undefined) {
      return { status: 'error', message: RECORD_FAILED_MESSAGE };
    }
    return {
      status: 'recorded',
      recording: { uri: settledUri, mimeType: 'audio/mp4', size, durationMs },
    };
  });

  return {
    start(): Promise<StartResult> {
      return Effect.runPromise(startEffect().pipe(Effect.catchCause(() => Effect.sync(micFailed))));
    },
    stop(): Promise<RecordResult> {
      const current = recorder;
      recorder = null;
      return Effect.runPromise(
        current === null
          ? Effect.succeed<RecordResult>({ status: 'cancelled' })
          : stopEffect(current),
      );
    },
    cancel(): Promise<void> {
      const current = recorder;
      recorder = null;
      return Effect.runPromise(
        current === null
          ? Effect.void
          : Effect.tryPromise({ try: () => current.stop(), catch: () => undefined }).pipe(
              // Discarding never reports: the mic is released either way.
              Effect.orElseSucceed(() => undefined),
              Effect.flatMap(() => restorePlaybackMode),
            ),
      );
    },
    currentDurationMs() {
      const current = recorder;
      return current === null ? 0 : Math.max(0, Math.round(current.currentTime * 1000));
    },
    currentLevel() {
      const db = recorder?.getStatus?.().metering;
      return db === undefined || !Number.isFinite(db)
        ? 0
        : Math.min(1, Math.max(0, (db + 60) / 60));
    },
    isRecording() {
      return recorder?.isRecording === true;
    },
  };
}

/**
 * The byte size of a recorded file via the documented `expo-file-system`
 * `size` property (0 when the file does not exist or cannot be read).
 * Undefined when the read itself failed ("unknown", not "empty").
 */
const readFileSize = (
  uri: string,
  reader?: ((uri: string) => Promise<{ size: number | undefined }>) | undefined,
): Effect.Effect<number | undefined> =>
  (reader !== undefined
    ? Effect.tryPromise({ try: () => reader(uri), catch: () => undefined }).pipe(
        Effect.map((read) => read.size),
      )
    : Effect.tryPromise({ try: () => import('expo-file-system'), catch: () => undefined }).pipe(
        Effect.map(({ File }) => new File(uri).size),
      )
  ).pipe(
    Effect.orElseSucceed((): number | undefined => undefined),
    Effect.catchDefect(() => Effect.succeed<number | undefined>(undefined)),
  );
