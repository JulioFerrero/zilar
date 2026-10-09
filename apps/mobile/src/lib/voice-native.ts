/**
 * The native voice seams (T-0154): recording with `expo-audio`, one shared
 * player per bubble, and a single-speaker registry so only one voice plays
 * at a time. Only imported by the composer/voice bubble (and tests through
 * the interfaces below), so Vitest never loads the native modules uninvoked.
 */

import { Effect, type Effect as EffectType } from 'effect';
import type { VoiceMeta } from '@zilar/protocol';
import type { SendFailureReason } from '@zilar/chat-core';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import { isTrustedMediaUrl, safeHttpUrl } from './attachments';

export const MIC_DENIED_MESSAGE =
  'Zilar needs access to your microphone to record voice messages. You can allow it in Settings.';
export const MIC_FAILED_MESSAGE = 'Could not start recording. Try again.';
export const RECORD_TOO_LONG_MESSAGE = 'That recording is too long to send.';
export const RECORD_FAILED_MESSAGE = 'Could not save the recording, try again.';

/**
 * Why a voice send failed: exactly the shared `SendFailureReason` buckets
 * (finding 4), reused from `chat-core` so the message keeps the shared
 * type. Mobile maps its voice pipeline errors onto these buckets.
 */
export type VoiceFailureReason = SendFailureReason;

/** Maps a pipeline error to the fixed failure bucket the bubble shows. */
export function voiceFailureReasonFor(error: unknown, offline: boolean): VoiceFailureReason {
  if (offline) {
    return 'network';
  }
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : '';
  if (code === 'voice_too_long' || code === 'voice_too_large' || code === 'too_large') {
    return 'too_large';
  }
  if (code === 'voice_empty' || code === 'voice_not_audio' || code === 'invalid_response') {
    return 'unsupported_file';
  }
  if (code === 'voice_too_short') {
    return 'unsupported_file';
  }
  if (
    code === 'convert_failed' ||
    code === 'voice_failed' ||
    (typeof code === 'string' && code.startsWith('voice_'))
  ) {
    return 'server_unavailable';
  }
  if (code === 'upload_refused' || code === 'upload_failed') {
    return 'upload_refused';
  }
  if (code === 'network_error' || code === 'network') {
    return 'network';
  }
  return 'server_unavailable';
}

/** The plain copy a failed voice bubble shows for its reason. */
export function voiceErrorCopy(reason: VoiceFailureReason): string {
  if (reason === 'network') {
    return 'Could not send. Check your connection.';
  }
  if (reason === 'too_large') {
    return 'That recording is too long to send.';
  }
  if (reason === 'unsupported_file') {
    return 'That recording could not be read.';
  }
  if (reason === 'upload_refused') {
    return 'Could not upload the recording.';
  }
  if (reason === 'server_unavailable') {
    return 'Could not send the voice message. Try again.';
  }
  return 'Sending took too long. Try again.';
}

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

/** Playback speeds, cycled by the bubble's speed button. */
export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];

/** One speaker: the bubble's player controls, fed by expo-audio. */
export interface VoiceSpeaker {
  readonly messageId: string;
  readonly playing: boolean;
  readonly positionMs: number;
  readonly durationMs: number;
  readonly speed: VoiceSpeed;
  play(): void;
  pause(): void;
  seekTo(positionMs: number): Promise<void>;
  cycleSpeed(): void;
  release(): void;
}

/**
 * Only one voice plays at a time: starting one pauses the other. The chat
 * screen owns the registry and stops it on unmount (leaving the chat stops
 * playback). Tests drive this without any native module.
 *
 * Identity is by message, not by object: `resign` clears whoever is current
 * for that message id, so the host can resign a bubble without holding the
 * exact claimed object (finding 1).
 */
export function createVoicePlayback(): {
  current(): VoiceSpeaker | undefined;
  claim(speaker: VoiceSpeaker): void;
  resign(speaker: VoiceSpeaker): void;
  stopAll(): void;
} {
  let current: VoiceSpeaker | undefined;
  return {
    current: () => current,
    claim(speaker) {
      if (current !== undefined && current.messageId !== speaker.messageId) {
        current.pause();
      }
      current = speaker;
    },
    resign(speaker) {
      if (current?.messageId === speaker.messageId) {
        current = undefined;
      }
    },
    stopAll() {
      current?.pause();
      current = undefined;
    },
  };
}

export type VoicePlayback = ReturnType<typeof createVoicePlayback>;

/**
 * Whether a voice message's bytes may be fetched: the URL must be http(s)
 * and on one of the store's trusted media hosts (the same gate as images).
 * An untrusted voice still shows its waveform and duration, but never loads.
 */
export function isPlayableVoiceUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (safeHttpUrl(url) === undefined) {
    return false;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}

/**
 * The `expo-audio` source for a voice message: the local file while it
 * uploads, else the served URL with the session bearer only to the API
 * origin (never to the upload host). Undefined when there is nothing to
 * play (untrusted URL, upload still running, already failed).
 */
export function voiceAudioSource(input: {
  voice: VoiceMeta;
  localUri?: string | undefined;
  trustedHosts: ReadonlySet<string>;
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
}): Promise<{ uri: string; headers?: Record<string, string> } | undefined> {
  return Effect.runPromise(voiceAudioSourceEffect(input));
}

const voiceAudioSourceEffect = Effect.fnUntraced(function* (
  input: Parameters<typeof voiceAudioSource>[0],
): EffectType.fn.Return<{ uri: string; headers?: Record<string, string> } | undefined> {
  if (input.localUri !== undefined && input.localUri !== '') {
    return { uri: input.localUri };
  }
  const url = input.voice.url;
  if (url === undefined || !isPlayableVoiceUrl(url, input.trustedHosts)) {
    return undefined;
  }
  const apiUrl = input.apiUrl ?? API_URL;
  const getToken = input.getToken ?? getSessionToken;
  const sameOrigin = yield* Effect.try({
    try: () => new URL(apiUrl).origin === new URL(url).origin,
    catch: () => false,
  }).pipe(Effect.orElseSucceed(() => false));
  if (!sameOrigin) {
    return { uri: url };
  }
  const token = yield* Effect.tryPromise({
    try: () => getToken(),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));
  return token === undefined
    ? { uri: url }
    : { uri: url, headers: { authorization: `Bearer ${token}` } };
});
