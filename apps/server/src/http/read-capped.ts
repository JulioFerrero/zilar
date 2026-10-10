// The capped upload-body read shared by the sticker, background, voice and
// avatar upload handlers (T-1054). It reads the raw request body stream chunk
// by chunk and stops as soon as the cap is passed, so a large upload never has
// to fit in memory.

import { Effect, Stream } from 'effect';

// Reads the body stream chunk by chunk and stops as soon as the cap is passed,
// so a large upload never has to fit in memory. `undefined` means the cap was
// exceeded; the over-cap chunk itself is not collected.
export function readCapped<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  cap: number,
): Effect.Effect<Uint8Array | undefined, E, R> {
  return Effect.gen(function* () {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let exceeded = false;
    yield* Stream.runForEachWhile(stream, (chunk) =>
      Effect.sync(() => {
        total += chunk.byteLength;
        if (total > cap) {
          exceeded = true;
          return false;
        }
        chunks.push(chunk);
        return true;
      }),
    );

    if (exceeded) {
      return undefined;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  });
}
