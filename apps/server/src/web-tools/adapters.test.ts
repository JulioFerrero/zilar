import { describe, expect, it } from 'vitest';
import { parseYahooChart, resolveYahooSymbol } from './price-adapter';

describe('resolveYahooSymbol', () => {
  it.each([
    ['SPX', '^GSPC'],
    ['^spx', '^GSPC'],
    ['SP500', '^GSPC'],
    ['GOLD', 'GC=F'],
    ['xau', 'GC=F'],
    ['xauusd', 'GC=F'],
    ['SILVER', 'SI=F'],
    ['xagusd', 'SI=F'],
    ['NDX', '^NDX'],
    ['nasdaq100', '^NDX'],
    ['DJI', '^DJI'],
    ['dow', '^DJI'],
    ['aapl.us', 'AAPL'],
    ['MSFT', 'MSFT'],
  ])('resolves %s to %s', (input, expected) => {
    expect(resolveYahooSymbol(input)).toBe(expected);
  });
});

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

  it('falls back to USD and an empty symbol when meta omits them', () => {
    const body = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 12 } }] } });
    expect(parseYahooChart(body)).toEqual({
      price: 12,
      currency: 'USD',
      time: undefined,
      symbol: '',
    });
  });

  it('is unavailable when chart.error is set', () => {
    const body = JSON.stringify({
      chart: {
        error: { code: 'Not Found', description: 'No data found' },
        result: null,
      },
    });
    expect(parseYahooChart(body)).toBeNull();
  });

  it('is unavailable when result is empty', () => {
    const body = JSON.stringify({ chart: { result: [], error: null } });
    expect(parseYahooChart(body)).toBeNull();
  });

  it('is unavailable when the price is not a finite number', () => {
    const body = JSON.stringify({
      chart: { result: [{ meta: { regularMarketPrice: 'n/a' } }], error: null },
    });
    expect(parseYahooChart(body)).toBeNull();
  });

  it('is unavailable on body that is not chart JSON', () => {
    expect(parseYahooChart('<html>nope</html>')).toBeNull();
  });
});
