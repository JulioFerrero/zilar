import type { VoiceMeta } from '@zilar/protocol';
import { Effect } from 'effect';

import { voiceAudioSource } from '@/lib/voice-native';

export const BAR_COUNT = 24;
// The bubble is at least this wide so the waveform can stretch to its end.
export const VOICE_MIN_WIDTH = 236;

/**
 * Resolves the play source and applies it only when the request is still
 * the latest (finding 3, round 3): two taps with out-of-order resolves play
 * only the latest tap's source. Extracted so tests drive the race without
 * rendering; the bubble runs the same function from `toggle`.
 */
export function resolvePlaySourceEffect(
  input: { voice: VoiceMeta; localUri?: string | undefined; trustedHosts: ReadonlySet<string> },
  seen: { current: number },
  request: number,
  onSource: (source: { uri: string; headers?: Record<string, string> }) => void,
  onMissing: () => void,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const source = yield* Effect.tryPromise({
      try: () => voiceAudioSource(input),
      catch: (error) => error,
    });
    if (seen.current !== request) {
      return;
    }
    if (source === undefined) {
      onMissing();
      return;
    }
    onSource(source);
  });
}

export function resolvePlaySource(
  input: { voice: VoiceMeta; localUri?: string | undefined; trustedHosts: ReadonlySet<string> },
  seen: { current: number },
  request: number,
  onSource: (source: { uri: string; headers?: Record<string, string> }) => void,
  onMissing: () => void,
): Promise<void> {
  return Effect.runPromise(resolvePlaySourceEffect(input, seen, request, onSource, onMissing));
}

export const resolved = (): Promise<void> => Effect.runPromise(Effect.void);

export const isPromiseLike = (value: unknown): value is PromiseLike<void> =>
  typeof value === 'object' && value !== null && 'then' in value;

export function sampleBars(waveform: readonly number[], count: number): number[] {
  if (waveform.length <= count) {
    return [...waveform];
  }
  return Array.from({ length: count }, (_, index) => {
    const position = (index / count) * waveform.length;
    return waveform[Math.floor(position)] ?? 0;
  });
}
