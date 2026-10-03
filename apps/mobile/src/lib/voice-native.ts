/**
 * The native voice seams (T-0154): recording with `expo-audio`, one shared
 * player per bubble, and a single-speaker registry so only one voice plays
 * at a time. Only imported by the composer/voice bubble (and tests through
 * the interfaces below), so Vitest never loads the native modules uninvoked.
 */

import type { VoiceMeta } from '@zilar/protocol';
import type { SendFailureReason } from '@zilar/chat-core';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import { isTrustedMediaUrl, safeHttpUrl } from './attachments';

export const MIC_DENIED_MESSAGE =
  'Zilar needs access to your microphone to record voice messages. You can allow it in Settings.';
export const MIC_FAILED_MESSAGE = 'Could not start recording. Try again.';
export const RECORD_TOO_SHORT_MESSAGE = 'Too short, hold the mic longer.';
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

/** Creates the real recorder: permission first, `expo-audio` m4a second. */
export function createVoiceRecorder(deps?: {
  audio?: {
    requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
    AudioRecorder: new (options: unknown) => NativeRecorderShape;
    HIGH_QUALITY?: unknown;
  };
  setAudioMode?:
    ((mode: { playsInSilentMode: boolean; allowsRecording: boolean }) => Promise<void>) | undefined;
  fileReader?: ((uri: string) => Promise<{ size: number | undefined }>) | undefined;
}): VoiceRecorderPort {
  let recorder: NativeRecorderShape | null = null;
  // Recording leaves the audio session in record mode, which makes playback
  // quiet and tinny on some phones: switch back once the mic is released.
  const restorePlaybackMode = async (): Promise<void> => {
    try {
      const mode = { playsInSilentMode: true, allowsRecording: false };
      if (deps?.setAudioMode === undefined) {
        const { setAudioModeAsync } = await import('expo-audio');
        await setAudioModeAsync(mode);
      } else {
        await deps.setAudioMode(mode);
      }
    } catch {
      // A nicety: never blocks sending.
    }
  };
  return {
    async start() {
      // Everything that can throw — the native import, the permission
      // request, the recorder build — lands in one handled failure (finding
      // 1, round 3): a missing native module (pre-rebuild) is a mic-failed
      // copy, never an unhandled rejection. A denial stays the denied copy.
      try {
        const audio: {
          requestRecordingPermissionsAsync: () => Promise<{ granted: boolean }>;
          AudioRecorder: new (options: unknown) => NativeRecorderShape;
          HIGH_QUALITY?: unknown;
        } =
          deps?.audio ??
          (await import('expo-audio').then((module) => ({
            requestRecordingPermissionsAsync: module.AudioModule.requestRecordingPermissionsAsync,
            AudioRecorder: module.AudioModule.AudioRecorder as new (
              options: unknown,
            ) => NativeRecorderShape,
            HIGH_QUALITY: module.RecordingPresets.HIGH_QUALITY as unknown,
          })));
        const permission = await audio.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          return { status: 'error', message: MIC_DENIED_MESSAGE };
        }
        if (deps?.setAudioMode === undefined) {
          try {
            const { setAudioModeAsync } = await import('expo-audio');
            await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
          } catch {
            // The audio mode is a nicety; a failure must not block recording.
          }
        } else {
          try {
            await deps.setAudioMode({ playsInSilentMode: true, allowsRecording: true });
          } catch {
            // The audio mode is a nicety; a failure must not block recording.
          }
        }
        // Mono 48 kHz AAC: a phone microphone is mono, so a stereo preset only
        // doubles the file; metering feeds the live waveform.
        const fresh = new audio.AudioRecorder({
          ...(audio.HIGH_QUALITY as object),
          sampleRate: 48000,
          numberOfChannels: 1,
          bitRate: 128000,
          isMeteringEnabled: true,
        });
        await fresh.prepareToRecordAsync();
        fresh.record();
        recorder = fresh;
        return { status: 'started' };
      } catch {
        recorder = null;
        return { status: 'error', message: MIC_FAILED_MESSAGE };
      }
    },
    async stop(): Promise<RecordResult> {
      const current = recorder;
      recorder = null;
      if (current === null) {
        return { status: 'cancelled' };
      }
      const durationMs = Math.max(0, Math.round(current.currentTime * 1000));
      const uri = current.uri;
      try {
        await current.stop();
      } catch {
        return { status: 'error', message: RECORD_FAILED_MESSAGE };
      } finally {
        await restorePlaybackMode();
      }
      const settledUri = current.uri ?? uri;
      if (settledUri === null || settledUri === '') {
        return { status: 'error', message: RECORD_FAILED_MESSAGE };
      }
      // A size failure is "unknown", never "empty": only a real zero refuses
      // as `voice_empty` downstream (finding 3).
      const size = await readFileSize(settledUri, deps?.fileReader);
      if (size === undefined) {
        return { status: 'error', message: RECORD_FAILED_MESSAGE };
      }
      const recorded: RecordResult = {
        status: 'recorded',
        recording: { uri: settledUri, mimeType: 'audio/mp4', size, durationMs },
      };
      return recorded;
    },
    async cancel() {
      const current = recorder;
      recorder = null;
      if (current === null) {
        return;
      }
      try {
        await current.stop();
      } catch {
        // Discarding never reports: the mic is released either way.
      }
      await restorePlaybackMode();
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
async function readFileSize(
  uri: string,
  reader?: ((uri: string) => Promise<{ size: number | undefined }>) | undefined,
): Promise<number | undefined> {
  try {
    if (reader !== undefined) {
      return (await reader(uri)).size;
    }
    const { File } = await import('expo-file-system');
    return new File(uri).size;
  } catch {
    return undefined;
  }
}

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
export async function voiceAudioSource(input: {
  voice: VoiceMeta;
  localUri?: string | undefined;
  trustedHosts: ReadonlySet<string>;
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
}): Promise<{ uri: string; headers?: Record<string, string> } | undefined> {
  if (input.localUri !== undefined && input.localUri !== '') {
    return { uri: input.localUri };
  }
  const url = input.voice.url;
  if (url === undefined || !isPlayableVoiceUrl(url, input.trustedHosts)) {
    return undefined;
  }
  const apiUrl = input.apiUrl ?? API_URL;
  const getToken = input.getToken ?? getSessionToken;
  let sameOrigin = false;
  try {
    sameOrigin = new URL(apiUrl).origin === new URL(url).origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    return { uri: url };
  }
  const token = await getToken().catch(() => undefined);
  return token === undefined
    ? { uri: url }
    : { uri: url, headers: { authorization: `Bearer ${token}` } };
}
