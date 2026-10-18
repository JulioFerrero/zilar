/**
 * Imported only by the composer and voice bubble (tests use the interfaces), so Vitest never loads the native modules uninvoked.
 */

import { Effect, type Effect as EffectType } from 'effect';
import { Platform } from 'react-native';

export const MIC_DENIED_MESSAGE =
  'Zilar needs access to your microphone to record voice messages. You can allow it in Settings.';
export const MIC_FAILED_MESSAGE = 'Could not start recording. Try again.';
export const RECORD_TOO_LONG_MESSAGE = 'That recording is too long to send.';
export const RECORD_FAILED_MESSAGE = 'Could not save the recording, try again.';

export interface FinishedRecording {
  uri: string;
  mimeType: string;
  size: number;
  durationMs: number;
}

export type RecordResult =
  | { status: 'recorded'; recording: FinishedRecording }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };
export interface VoiceRecorderPort {
  start(): Promise<{ status: 'started' } | { status: 'error'; message: string }>;
  stop(): Promise<RecordResult>;
  cancel(): Promise<void>;
  currentDurationMs(): number;
  currentLevel(): number;
  isRecording(): boolean;
}

export interface NativeRecorderShape {
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  uri: string | null;
  isRecording: boolean;
  currentTime: number;
  getStatus?: () => { metering?: number | undefined };
}

export interface RecordingAudio {
  requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
  AudioRecorder: new (options: unknown) => NativeRecorderShape;
  HIGH_QUALITY?: unknown;
}

type AudioMode = { playsInSilentMode: boolean; allowsRecording: boolean };
type StartResult = { status: 'started' } | { status: 'error'; message: string };

/**
 * `RecordingPresets.HIGH_QUALITY` keeps the codec settings under `ios`/`android`; `AudioModule.AudioRecorder` does not flatten them, and the raw preset left Android with no output format (3GP, AMR-NB, 8 kHz), so the platform block is flattened in here.
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

/**
 * A failure here never blocks recording or playback, so every error is swallowed.
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

export function createVoiceRecorder(deps?: {
  audio?: RecordingAudio;
  setAudioMode?: ((mode: AudioMode) => Promise<void>) | undefined;
  fileReader?: ((uri: string) => Promise<{ size: number | undefined }>) | undefined;
  platform?: string | undefined;
}): VoiceRecorderPort {
  let recorder: NativeRecorderShape | null = null;
  // Recording leaves the audio session in record mode, which makes playback quiet and tinny on some phones.
  const restorePlaybackMode = setAudioModeEffect(deps?.setAudioMode, {
    playsInSilentMode: true,
    allowsRecording: false,
  });
  const recordMode = setAudioModeEffect(deps?.setAudioMode, {
    playsInSilentMode: true,
    allowsRecording: true,
  });

  // The native import, the permission request and the recorder build land in one handled failure.
  const startEffect = Effect.fnUntraced(function* (): EffectType.fn.Return<StartResult, unknown> {
    const audio = deps?.audio ?? (yield* loadExpoAudio);
    const permission = yield* Effect.promise(() => audio.requestRecordingPermissionsAsync());
    if (!permission.granted) {
      return { status: 'error', message: MIC_DENIED_MESSAGE };
    }
    yield* recordMode;
    // A phone microphone is mono, so a stereo preset only doubles the file; metering feeds the waveform.
    const os = deps?.platform ?? Platform.OS;
    const fresh = new audio.AudioRecorder(buildRecordingOptions(audio.HIGH_QUALITY, os));
    yield* Effect.promise(() => fresh.prepareToRecordAsync());
    fresh.record();
    recorder = fresh;
    return { status: 'started' };
  });

  // A missing native module is a mic-failed copy, never an unhandled rejection.
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
    // A size failure is unknown, never empty: only a real zero refuses as `voice_empty`.
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
 * Undefined when the read itself failed (unknown, not empty).
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
