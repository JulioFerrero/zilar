import { Effect } from 'effect';
import { promiseOf } from './convert';
import { WAVEFORM_BUCKETS } from './recorder';

/**
 * Peak buckets for the bubble. Decoding uses `AudioContext`; any failure (or a
 * browser without it, like jsdom) falls back to a quiet flat waveform.
 */
export function computeWaveform(blob: Blob, buckets = WAVEFORM_BUCKETS): Promise<number[]> {
  return promiseOf(() => computeWaveformEffect(blob, buckets));
}

function peaksOf(decoded: AudioBuffer, buckets: number): number[] {
  const channel = decoded.getChannelData(0);
  const perBucket = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = bucket * perBucket;
    const end = Math.min(channel.length, start + perBucket);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(channel[index] ?? 0);
      if (value > peak) {
        peak = value;
      }
    }
    peaks.push(Math.min(255, Math.round(peak * 255)));
  }
  return peaks;
}

export const computeWaveformEffect = (
  blob: Blob,
  buckets = WAVEFORM_BUCKETS,
): Effect.Effect<number[]> =>
  Effect.suspend(() => {
    const fallback = Array.from({ length: buckets }, () => 12);
    const AudioContextCtor = typeof AudioContext === 'undefined' ? undefined : AudioContext;
    if (AudioContextCtor === undefined) {
      return Effect.succeed(fallback);
    }
    // The context is closed after every outcome; a failed close is ignored.
    return Effect.acquireUseRelease(
      Effect.try(() => new AudioContextCtor()),
      (context) =>
        Effect.gen(function* () {
          const bytes = yield* Effect.tryPromise(() => blob.arrayBuffer());
          const decoded = yield* Effect.tryPromise(() => context.decodeAudioData(bytes));
          return yield* Effect.try(() => peaksOf(decoded, buckets));
        }),
      (context) =>
        Effect.suspend(() => {
          const closing = context.close();
          return Effect.tryPromise(() => closing).pipe(Effect.ignore);
        }),
    ).pipe(Effect.orElseSucceed(() => fallback));
  });
