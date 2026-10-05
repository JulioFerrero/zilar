/**
 * Pure audio helpers behind the native decode (T-0177): the tested twins of
 * `appendDecodedSamples` + `resampleTo16k` and the chunk splitter in
 * `ZilarWhistleModule.kt`. The native side downmixes interleaved 16-bit
 * frames to mono first, then resamples that mono buffer with channel count
 * 1 — never the interleaved path twice.
 */
export const WHISTLE_SAMPLE_RATE = 16000;
export const WHISTLE_MAX_CHUNK_SAMPLES = 28 * WHISTLE_SAMPLE_RATE;
export const WHISTLE_CUT_SEARCH_SAMPLES = 2 * WHISTLE_SAMPLE_RATE;

export interface WhistleChunk {
  start: number;
  end: number;
}

/**
 * Downmixes interleaved 16-bit frames to mono float PCM in [-1, 1], the way
 * the native `appendDecodedSamples` does (average the channels per frame).
 */
export function downmixToMono(interleaved: readonly number[], channels: number): number[] {
  if (channels <= 1) {
    return interleaved.map((sample) => Math.min(1, Math.max(-1, sample)));
  }
  const frames = Math.floor(interleaved.length / channels);
  const mono: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += interleaved[frame * channels + channel] ?? 0;
    }
    mono.push(Math.min(1, Math.max(-1, sum / channels)));
  }
  return mono;
}

/**
 * Resamples mono PCM to 16 kHz with linear interpolation, the way the native
 * `resampleTo16k` does once it receives the already-downmixed buffer. Takes
 * only mono: call `downmixToMono` first for interleaved input.
 */
export function resampleMonoTo16k(mono: readonly number[], sampleRate: number): number[] {
  if (mono.length === 0 || sampleRate <= 0 || sampleRate === WHISTLE_SAMPLE_RATE) {
    return [...mono];
  }
  const ratio = sampleRate / WHISTLE_SAMPLE_RATE;
  const outSize = Math.floor(mono.length / ratio);
  const out: number[] = [];
  for (let index = 0; index < outSize; index += 1) {
    const position = index * ratio;
    const lower = Math.min(Math.max(0, Math.floor(position)), mono.length - 1);
    const upper = Math.min(lower + 1, mono.length - 1);
    const fraction = position - lower;
    out.push((mono[lower] ?? 0) * (1 - fraction) + (mono[upper] ?? 0) * fraction);
  }
  return out;
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
