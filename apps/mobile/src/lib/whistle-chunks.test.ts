import { describe, expect, it } from 'vitest';

import {
  downmixToMono,
  isSilentPcm,
  planQuietCutChunks,
  planWhistleChunks,
  quietestCut,
  resampleMonoTo16k,
  WHISTLE_MAX_CHUNK_SAMPLES,
  WHISTLE_SAMPLE_RATE,
} from './whistle-last-voice';

const SECOND = WHISTLE_SAMPLE_RATE;

describe('whistle chunk plan (T-0177)', () => {
  it('a 10 s clip is one chunk', () => {
    expect(planWhistleChunks(10 * SECOND)).toEqual([{ start: 0, end: 10 * SECOND }]);
  });

  it('a 30 s clip needs two chunks (28 s + 2 s)', () => {
    const chunks = planWhistleChunks(30 * SECOND);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ start: 0, end: 28 * SECOND });
    expect(chunks[1]).toEqual({ start: 28 * SECOND, end: 30 * SECOND });
  });

  it('a 61 s clip needs three chunks, gapless and capped at 28 s', () => {
    const chunks = planWhistleChunks(61 * SECOND);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ start: 0, end: 28 * SECOND });
    expect(chunks[1]).toEqual({ start: 28 * SECOND, end: 56 * SECOND });
    expect(chunks[2]).toEqual({ start: 56 * SECOND, end: 61 * SECOND });
    for (const chunk of chunks) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(WHISTLE_MAX_CHUNK_SAMPLES);
    }
  });

  it('empty and invalid input plans nothing', () => {
    expect(planWhistleChunks(0)).toEqual([]);
    expect(planWhistleChunks(-5)).toEqual([]);
    expect(planWhistleChunks(1.5)).toEqual([]);
  });
});

describe('quietest cut (T-0177)', () => {
  it('cuts at the quietest sample in the last 2 s', () => {
    const amplitudes = (sample: number): number => (sample === 100 ? 0 : 0.9);
    expect(quietestCut(amplitudes, 0, 200)).toBe(101);
  });

  it('ties keep the earliest sample', () => {
    expect(quietestCut(() => 0.5, 10, 20)).toBe(11);
  });

  it('a 61 s clip cut at the quiet point stays gapless under 28 s', () => {
    const silenceAt = 28 * SECOND - 500;
    const amplitudes = (sample: number): number => (sample === silenceAt ? 0 : 0.8);
    const chunks = planQuietCutChunks(61 * SECOND, amplitudes);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.end).toBe(silenceAt + 1);
    expect(chunks[1]?.start).toBe(silenceAt + 1);
    for (const chunk of chunks) {
      expect(chunk.end - chunk.start).toBeLessThanOrEqual(WHISTLE_MAX_CHUNK_SAMPLES);
      expect(chunk.end - chunk.start).toBeGreaterThan(0);
    }
    expect(chunks.at(-1)?.end).toBe(61 * SECOND);
  });

  it('silence still yields valid gapless chunks', () => {
    const chunks = planQuietCutChunks(61 * SECOND, () => 0);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(61 * SECOND);
    for (const chunk of chunks) {
      expect(chunk.end - chunk.start).toBeGreaterThan(0);
    }
  });

  it('detects silence below the floor', () => {
    expect(isSilentPcm([0, 0.001, -0.004])).toBe(true);
    expect(isSilentPcm([0, 0.5, 0])).toBe(false);
    expect(isSilentPcm([])).toBe(true);
  });
});

describe('downmix + resample arithmetic (T-0177 finding 2)', () => {
  it('downmixes stereo frames to mono once, clamped to [-1, 1]', () => {
    expect(downmixToMono([0.5, -0.5, 1, 1], 2)).toEqual([0, 1]);
    expect(downmixToMono([2, 2], 2)).toEqual([1]);
    expect(downmixToMono([0.25], 1)).toEqual([0.25]);
  });

  it('resamples mono 48 kHz to 16 kHz with linear interpolation', () => {
    const mono = [0, 1, 2, 3, 4, 5];
    const resampled = resampleMonoTo16k(mono, 48000);
    // 6 samples at 48 kHz cover 2 samples at 16 kHz (ratio 3).
    expect(resampled).toHaveLength(2);
    expect(resampled[0]).toBeCloseTo(0, 5);
    expect(resampled[1]).toBeCloseTo(3, 5);
  });

  it('leaves 16 kHz mono untouched and handles empty input', () => {
    expect(resampleMonoTo16k([0.1, 0.2], 16000)).toEqual([0.1, 0.2]);
    expect(resampleMonoTo16k([], 48000)).toEqual([]);
  });

  it('decode order (downmix then resample-as-mono) matches the native path', () => {
    // Interleaved stereo at 48 kHz: the native side downmixes first (floats
    // clamped to [-1, 1]), then calls resampleTo16k(mono, rate, 1) — never
    // the interleaved branch.
    const interleaved = [0, 0, 0.3, 0.3, 0.6, 0.6, 0.9, 0.9, 0.2, 0.2, 0.5, 0.5];
    const mono = downmixToMono(interleaved, 2);
    expect(mono).toEqual([0, 0.3, 0.6, 0.9, 0.2, 0.5]);
    const resampled = resampleMonoTo16k(mono, 48000);
    expect(resampled).toHaveLength(2);
    expect(resampled[0]).toBeCloseTo(0, 5);
    expect(resampled[1]).toBeCloseTo(0.9, 5);
  });
});
