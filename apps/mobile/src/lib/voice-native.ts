/**
 * The native voice seams (T-0154): recording with `expo-audio`, one shared
 * player per bubble, and a single-speaker registry so only one voice plays
 * at a time. Only imported by the composer/voice bubble (and tests through
 * the interfaces below), so Vitest never loads the native modules uninvoked.
 */

import type { VoiceMeta } from '@zilar/protocol';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import { isTrustedMediaUrl, safeHttpUrl } from './attachments';

export const MIC_DENIED_MESSAGE =
  'Zilar needs access to your microphone to record voice messages. You can allow it in Settings.';
export const MIC_BUSY_MESSAGE = 'The microphone is busy. Try again.';
export const MIC_FAILED_MESSAGE = 'Could not start recording. Try again.';
export const RECORD_TOO_SHORT_MESSAGE =
  'That recording was too short. Hold the mic a moment longer.';
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
  /** True while the recorder holds the microphone. */
  isRecording(): boolean;
}

/** Creates the real recorder: permission first, `expo-audio` m4a second. */
export function createVoiceRecorder(): VoiceRecorderPort {
  let recorder: {
    prepareToRecordAsync: () => Promise<void>;
    record: () => void;
    stop: () => Promise<void>;
    uri: string | null;
    isRecording: boolean;
    currentTime: number;
  } | null = null;
  return {
    async start() {
      const { AudioModule, RecordingPresets, setAudioModeAsync } = await import('expo-audio');
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        return { status: 'error', message: MIC_DENIED_MESSAGE };
      }
      try {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      } catch {
        // The audio mode is a nicety; a failure must not block recording.
      }
      try {
        const fresh = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
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
      }
      const settledUri = current.uri ?? uri;
      if (settledUri === null || settledUri === '') {
        return { status: 'error', message: RECORD_FAILED_MESSAGE };
      }
      const { File } = await import('expo-file-system');
      const size = await fileSizeOf(new File(settledUri) as unknown);
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
    },
    currentDurationMs() {
      const current = recorder;
      return current === null ? 0 : Math.max(0, Math.round(current.currentTime * 1000));
    },
    isRecording() {
      return recorder?.isRecording === true;
    },
  };
}

/** The byte size of a recorded file, 0 when it cannot be read. */
async function fileSizeOf(file: unknown): Promise<number> {
  try {
    const sized = file as { info: () => { size: number | null } };
    return sized.info().size ?? 0;
  } catch {
    return 0;
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
      if (current !== undefined && current !== speaker) {
        current.pause();
      }
      current = speaker;
    },
    resign(speaker) {
      if (current === speaker) {
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
