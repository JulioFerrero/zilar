import { describe, expect, it } from 'vitest';
import { MAX_MONTHLY_USD, validateLimits } from './ai-limits';

describe('validateLimits', () => {
  it('treats both empty fields as no limit', () => {
    const result = validateLimits('', '');
    expect(result.limits).toEqual({ perDayUsd: null, perMonthUsd: null });
    expect(result.dayError).toBe('');
    expect(result.monthError).toBe('');
  });

  it('treats one empty field as no limit for that bound', () => {
    expect(validateLimits('2', '').limits).toEqual({ perDayUsd: 2, perMonthUsd: null });
    expect(validateLimits('', '20').limits).toEqual({ perDayUsd: null, perMonthUsd: 20 });
  });

  it('still rejects a day above the month when both are set', () => {
    const result = validateLimits('30', '20');
    expect(result.dayError).toBe('The daily limit must not exceed the monthly limit');
    expect(result.limits).toBeNull();
  });

  it('rejects a non-positive or non-numeric amount', () => {
    expect(validateLimits('0', '').limits).toBeNull();
    expect(validateLimits('abc', '').limits).toBeNull();
  });

  it('caps the month at MAX_MONTHLY_USD', () => {
    const result = validateLimits('', String(MAX_MONTHLY_USD + 1));
    expect(result.monthError).toBe(`The monthly limit must be at most $${MAX_MONTHLY_USD}`);
    expect(result.limits).toBeNull();
  });
});
