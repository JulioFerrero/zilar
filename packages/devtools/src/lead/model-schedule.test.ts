import { describe, expect, it } from 'vitest';
import { FREE_MUSE } from './fallback';
import { DEEPSEEK_FLASH, isDeepSeekPeak, resolveWorkerModel } from './model-schedule';

// 2026-10-05 is a Monday UTC; 2026-10-10 is a Saturday.
const monday = (time: string): Date => new Date(`2026-10-05T${time}:00.000Z`);

describe('isDeepSeekPeak', () => {
  it.each([
    ['00:59', false],
    ['01:00', true],
    ['03:59', true],
    ['04:00', false],
    ['05:59', false],
    ['06:00', true],
    ['09:59', true],
    ['10:00', false],
  ])('Monday %s UTC is peak=%s', (time, peak) => {
    expect(isDeepSeekPeak(monday(time))).toBe(peak);
  });

  it('treats the weekend as off-peak all day', () => {
    expect(isDeepSeekPeak(new Date('2026-10-10T07:00:00.000Z'))).toBe(false);
  });
});

describe('resolveWorkerModel', () => {
  it('uses DeepSeek flash with default effort off-peak', () => {
    expect(resolveWorkerModel('auto', monday('00:59'))).toEqual({
      model: DEEPSEEK_FLASH,
      effortOverride: 'default',
    });
  });

  it('uses the free Muse in peak hours', () => {
    expect(resolveWorkerModel('auto', monday('09:59'))).toEqual({ model: FREE_MUSE });
  });

  it('passes an explicit model through unchanged', () => {
    expect(resolveWorkerModel('deepseek/deepseek-flash', monday('09:59'))).toEqual({
      model: 'deepseek/deepseek-flash',
    });
  });
});
