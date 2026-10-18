import { Effect, type Effect as EffectType } from 'effect';
import type { VoiceMeta } from '@zilar/protocol';

import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import { isTrustedMediaUrl, safeHttpUrl } from './attachments';

export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];

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
 * Starting one voice pauses the other; identity is by message, not object, so the host can resign a bubble without holding the claimed object.
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
 * http(s) on one of the store's trusted media hosts, the same gate as images; an untrusted voice shows its waveform but never loads.
 */
export function isPlayableVoiceUrl(url: string, trustedHosts: ReadonlySet<string>): boolean {
  if (safeHttpUrl(url) === undefined) {
    return false;
  }
  return isTrustedMediaUrl(url, trustedHosts);
}

/**
 * The bearer goes only to the API origin, never to the upload host; undefined when there is nothing to play.
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
