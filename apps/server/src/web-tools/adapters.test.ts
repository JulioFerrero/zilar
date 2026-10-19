import { describe, expect, it } from 'vitest';
import { parseYahooChart } from './price-adapter';

describe('parseYahooChart', () => {
  it('reads the price, currency and time from meta', () => {
    const body = JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: 2650.5,
              regularMarketTime: 1790742500,
              currency: 'USD',
              symbol: 'GC=F',
            },
          },
        ],
        error: null,
      },
    });
    expect(parseYahooChart(body)).toEqual({
      price: 2650.5,
      currency: 'USD',
      time: 1790742500,
      symbol: 'GC=F',
    });
  });
});
