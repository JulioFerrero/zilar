import { describe, expect, it } from 'vitest';
import { fallbackModel } from './fallback.js';
import { DEEPSEEK_FLASH, FREE_MUSE, GO_DEEPSEEK_FLASH, PAID_MUSE } from './models.js';
import { isDeepSeekPeak, resolveWorkerModel } from './model-schedule.js';

// A Monday inside DeepSeek's old peak window (01:00-04:00 UTC): the hour that
// used to pick the free Muse.
const PEAK = new Date('2026-10-12T02:00:00Z');
// A Monday outside it.
const OFF_PEAK = new Date('2026-10-12T14:00:00Z');

describe('resolveWorkerModel (model: auto)', () => {
  it('picks the Go DeepSeek Flash at a peak hour too (T-1242)', () => {
    expect(isDeepSeekPeak(PEAK)).toBe(true);
    expect(resolveWorkerModel('auto', PEAK)).toEqual({
      model: GO_DEEPSEEK_FLASH,
      effortOverride: 'default',
    });
  });

  it('picks the same Go model off-peak', () => {
    expect(isDeepSeekPeak(OFF_PEAK)).toBe(false);
    expect(resolveWorkerModel('auto', OFF_PEAK)).toEqual({
      model: GO_DEEPSEEK_FLASH,
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
  it('moves the Go model to the metered DeepSeek API first (T-1242)', () => {
    expect(fallbackModel(GO_DEEPSEEK_FLASH)).toBe(DEEPSEEK_FLASH);
  });

  it('then moves the DeepSeek API to the paid Muse', () => {
    expect(fallbackModel(DEEPSEEK_FLASH)).toBe(PAID_MUSE);
  });

  it('still moves the free Muse straight to the paid Muse', () => {
    expect(fallbackModel(FREE_MUSE)).toBe(PAID_MUSE);
  });

  it('has no fallback for the paid Muse or an unknown model', () => {
    expect(fallbackModel(PAID_MUSE)).toBeUndefined();
    expect(fallbackModel('opencode-go/deepseek-v4-flash')).toBeUndefined();
  });
});
