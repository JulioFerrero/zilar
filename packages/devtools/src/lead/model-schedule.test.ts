import { describe, expect, it } from 'vitest';
import { fallbackModel } from './fallback.js';
import {
  DEEPSEEK_FLASH,
  FREE_DEEPSEEK_FLASH,
  FREE_GLM_FLASH,
  FREE_MUSE,
  GO_DEEPSEEK_FLASH,
  GO_MUSE,
  modelLabel,
  PAID_MUSE,
} from './models.js';
import { isDeepSeekPeak, resolveWorkerModel } from './model-schedule.js';

// A Monday inside DeepSeek's old peak window (01:00-04:00 UTC): the hour that
// used to pick the free Muse.
const PEAK = new Date('2026-10-12T02:00:00Z');
// A Monday outside it.
const OFF_PEAK = new Date('2026-10-12T14:00:00Z');

describe('resolveWorkerModel (model: auto)', () => {
  it('picks the free DeepSeek Flash at a peak hour too (T-1718)', () => {
    expect(isDeepSeekPeak(PEAK)).toBe(true);
    expect(resolveWorkerModel('auto', PEAK)).toEqual({
      model: FREE_DEEPSEEK_FLASH,
      effortOverride: 'default',
    });
  });

  it('picks the same free model off-peak', () => {
    expect(isDeepSeekPeak(OFF_PEAK)).toBe(false);
    expect(resolveWorkerModel('auto', OFF_PEAK)).toEqual({
      model: FREE_DEEPSEEK_FLASH,
      effortOverride: 'default',
    });
  });

  it('leaves an explicit model untouched', () => {
    expect(resolveWorkerModel('opencode/muse-spark-1.3-contributor-free', PEAK)).toEqual({
      model: FREE_MUSE,
    });
  });
});

describe('fallbackModel', () => {
  it('moves the free DeepSeek Flash to the Go DeepSeek Flash first (T-1718)', () => {
    expect(fallbackModel(FREE_DEEPSEEK_FLASH)).toBe(GO_DEEPSEEK_FLASH);
  });

  it('then moves the Go model to the metered DeepSeek API (T-1242)', () => {
    expect(fallbackModel(GO_DEEPSEEK_FLASH)).toBe(DEEPSEEK_FLASH);
  });

  it('then moves the DeepSeek API to the Go Muse (T-1362)', () => {
    expect(fallbackModel(DEEPSEEK_FLASH)).toBe(GO_MUSE);
  });

  it('moves the free Muse to the free GLM Flash first (T-1718)', () => {
    expect(fallbackModel(FREE_MUSE)).toBe(FREE_GLM_FLASH);
  });

  it('then moves the free GLM Flash to the Go Muse (T-1718)', () => {
    expect(fallbackModel(FREE_GLM_FLASH)).toBe(GO_MUSE);
  });

  it('moves the Go Muse to the paid Muse', () => {
    expect(fallbackModel(GO_MUSE)).toBe(PAID_MUSE);
  });

  it('has no fallback for the paid Muse or an unknown model', () => {
    expect(fallbackModel(PAID_MUSE)).toBeUndefined();
    expect(fallbackModel('opencode-go/deepseek-v4-flash')).toBeUndefined();
  });
});

describe('modelLabel', () => {
  it('names every listing in the chains, and passes an unknown id through', () => {
    expect(modelLabel(FREE_DEEPSEEK_FLASH)).toBe('free DeepSeek flash');
    expect(modelLabel(GO_DEEPSEEK_FLASH)).toBe('Go DeepSeek flash');
    expect(modelLabel(DEEPSEEK_FLASH)).toBe('DeepSeek flash (API)');
    expect(modelLabel(FREE_MUSE)).toBe('free Muse');
    expect(modelLabel(FREE_GLM_FLASH)).toBe('free GLM flash');
    expect(modelLabel(GO_MUSE)).toBe('Go Muse');
    expect(modelLabel(PAID_MUSE)).toBe('paid Muse');
    expect(modelLabel('opencode/unknown')).toBe('opencode/unknown');
  });
});
