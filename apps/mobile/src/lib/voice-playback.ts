/**
 * The native voice playback seams (T-0154): one shared speaker per bubble, a
 * single-speaker registry so only one voice plays at a time, and the
 * `expo-audio` source for a voice message. Split out of `voice-native.ts`
 * (T-1030).
 */

import { Effect, type Effect as EffectType } from 'effect';
import type { VoiceMeta } from '@zilar/protocol';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import { isTrustedMediaUrl, safeHttpUrl } from './attachments';

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
