/**
 * Splits 16 kHz mono PCM into consecutive chunks of at most 28 s for the
 * 30 s Whistle engine limit (T-0177): the tested pure plan behind the native
 * `splitIntoChunks`, kept in JS so Vitest covers the rule. Each cut lands on
 * the quietest sample in the last 2 s of the chunk, never mid-sample (cuts
 * are sample indexes by construction).
 */
export const WHISTLE_SAMPLE_RATE = 16000;
export const WHISTLE_MAX_CHUNK_SAMPLES = 28 * WHISTLE_SAMPLE_RATE;
export const WHISTLE_CUT_SEARCH_SAMPLES = 2 * WHISTLE_SAMPLE_RATE;

export interface WhistleChunk {
  start: number;
  end: number;
}

export function planWhistleChunks(totalSamples: number): WhistleChunk[] {
  if (!Number.isInteger(totalSamples) || totalSamples <= 0) {
    return [];
  }
  if (totalSamples <= WHISTLE_MAX_CHUNK_SAMPLES) {
    return [{ start: 0, end: totalSamples }];
  }
  const chunks: WhistleChunk[] = [];
  let start = 0;
  while (start < totalSamples) {
    const end = Math.min(start + WHISTLE_MAX_CHUNK_SAMPLES, totalSamples);
    if (end === totalSamples) {
      chunks.push({ start, end });
      break;
    }
    chunks.push({ start, end });
    start = end;
  }
  return chunks;
}

/**
 * Picks the cut sample inside `[searchFrom, hardEnd)`: the quietest absolute
 * amplitude wins, ties keep the earliest sample. The caller passes the hard
 * 28 s end; this returns the sample the chunk ends after (exclusive).
 */
export function quietestCut(
  amplitudes: (sample: number) => number,
  searchFrom: number,
  hardEnd: number,
): number {
  const from = Math.max(0, Math.floor(searchFrom));
  const end = Math.max(from + 1, Math.floor(hardEnd));
  let best = from;
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let index = from; index < end; index += 1) {
    const energy = Math.abs(amplitudes(index));
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = index;
    }
  }
  return best + 1;
}

/**
 * Plans the quiet-cut chunks for a full clip: consecutive 28 s windows,
 * each (except the last) cut at the quietest sample of its final 2 s.
 * `amplitudes` reads the absolute sample value at an index; silence (all
 * zeros) still yields valid, non-empty, gapless chunks.
 */
export function planQuietCutChunks(
  totalSamples: number,
  amplitudes: (sample: number) => number,
): WhistleChunk[] {
  if (!Number.isInteger(totalSamples) || totalSamples <= 0) {
    return [];
  }
  const chunks: WhistleChunk[] = [];
  let start = 0;
  while (start < totalSamples) {
    const hardEnd = Math.min(start + WHISTLE_MAX_CHUNK_SAMPLES, totalSamples);
    if (hardEnd === totalSamples) {
      chunks.push({ start, end: totalSamples });
      break;
    }
    const searchFrom = Math.max(start, hardEnd - WHISTLE_CUT_SEARCH_SAMPLES);
    const cut = Math.min(
      Math.max(quietestCut(amplitudes, searchFrom, hardEnd), start + 1),
      hardEnd,
    );
    chunks.push({ start, end: cut });
    start = cut;
  }
  return chunks;
}

/** True when every sample is below the silence floor. */
export function isSilentPcm(samples: readonly number[], floor = 0.005): boolean {
  return samples.every((sample) => Math.abs(sample) < floor);
}
