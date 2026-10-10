import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats a currency amount', () => {
    expect(formatMoney({ currency: 'EUR', amount: 0.02 })).toBe('€0.02');
    expect(formatMoney({ currency: 'USD', amount: 12.5 })).toBe('$12.50');
  });

  it('falls back to the plain string when Intl throws', () => {
    vi.spyOn(Intl, 'NumberFormat').mockImplementation(() => {
      throw new RangeError('no currency');
    });
    expect(formatMoney({ currency: 'EUR', amount: 0.02 })).toBe('EUR 0.02');
  });
});
