import { describe, expect, it } from 'vitest';

import {
  isSilentPcm,
  planQuietCutChunks,
  planWhistleChunks,
  quietestCut,
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
