// T-0125: price parser tests. Recorded-shape CoinGecko and Stooq
// responses parse; NaN/Infinity/empty/`N/D` are unavailable; symbol
// validation and the crypto table live here too (the 10-symbol cap is
// asserted at the adapter schema level in `adapters.test.ts`).
import { describe, expect, it } from 'vitest';
import {
  coingeckoLines,
  CRYPTO_IDS,
  parseStooqCsv,
  PRICE_SYMBOL_PATTERN,
  splitCsvLine,
  stooqStamp,
} from './prices';

describe('coingeckoLines (T-0125)', () => {
  it('parses a recorded-shape simple/price response', () => {
    const body = JSON.stringify({
      bitcoin: { usd: 83362, last_updated_at: 1790742500 },
      ethereum: { usd: 4120 },
    });
    const { lines, unknownIds } = coingeckoLines(['BTC', 'ETH'], ['bitcoin', 'ethereum'], body);
    expect(unknownIds.size).toBe(0);
    expect(lines[0]?.line).toBe(
      'BTC price 83362 USD (as of 2026-09-30T04:28:20.000Z, source coingecko)',
    );
    expect(lines[1]?.line).toBe('ETH price 4120 USD (as of unknown, source coingecko)');
  });

  it('reports unknown ids and unparseable bodies as unavailable', () => {
    const { lines, unknownIds } = coingeckoLines(
      ['BTC'],
      ['not-a-coin'],
      JSON.stringify({ bitcoin: { usd: 1 } }),
    );
    expect(unknownIds.has('not-a-coin')).toBe(true);
    expect(lines[0]?.line).toBe('BTC unknown symbol (not in the crypto table)');
    const broken = coingeckoLines(['BTC'], ['bitcoin'], 'not json');
    expect(broken.lines[0]?.line).toBe('BTC unavailable (source coingecko)');
    const badNumber = coingeckoLines(['BTC'], ['bitcoin'], JSON.stringify({ bitcoin: {} }));
    expect(badNumber.lines[0]?.line).toBe('BTC unavailable (source coingecko)');
  });
});

describe('parseStooqCsv (T-0125)', () => {
  it('parses a recorded-shape quote CSV', () => {
    const body = [
      'Symbol,Date,Time,Open,High,Low,Close,Volume',
      'XAUUSD,2026-09-29,22:00:00,4120.10,4130.00,4115.50,4128.75,0',
      '^SPX,2026-09-29,22:00:00,6700.00,6710.00,6690.00,6705.12,0',
      'AAPL.US,2026-09-29,22:00:00,250.00,251.00,249.00,250.55,1000',
    ].join('\n');
    const quotes = parseStooqCsv(body);
    expect(quotes.get('XAUUSD')?.close).toBe(4128.75);
    expect(quotes.get('^SPX')?.close).toBe(6705.12);
    expect(quotes.get('AAPL.US')?.close).toBe(250.55);
    expect(stooqStamp({ date: '2026-09-29', time: '22:00:00' })).toBe('2026-09-29 22:00:00');
  });

  it('treats NaN/Infinity/empty/N/D closes as missing rows', () => {
    const body = [
      'Symbol,Date,Time,Open,High,Low,Close,Volume',
      'AAA,2026-09-29,22:00:00,1,1,1,,0',
      'BBB,2026-09-29,22:00:00,1,1,1,N/D,0',
      'CCC,2026-09-29,22:00:00,1,1,1,n/d,0',
      'DDD,2026-09-29,22:00:00,1,1,1,Infinity,0',
      'EEE,2026-09-29,22:00:00,1,1,1,NaN,0',
      'FFF,2026-09-29,22:00:00,1,1,1,12.5,0',
    ].join('\n');
    const quotes = parseStooqCsv(body);
    expect([...quotes.keys()]).toEqual(['FFF']);
  });

  it('ignores quoted commas, a missing header and duplicate rows', () => {
    const body = [
      'Symbol,Date,Time,Open,High,Low,Close,Volume',
      '"XAU,USD",2026-09-29,22:00:00,1,1,1,9.5,0',
      'XAUUSD,2026-09-29,22:00:00,1,1,1,9.5,0',
      'XAUUSD,2026-09-29,22:00:00,1,1,1,10.5,0',
    ].join('\r\n');
    const quotes = parseStooqCsv(body);
    expect(quotes.get('XAU,USD')?.close).toBe(9.5);
    expect(quotes.get('XAUUSD')?.close).toBe(9.5);
    expect(parseStooqCsv('no header here')).toEqual(new Map());
  });
});

describe('splitCsvLine (T-0125)', () => {
  it('honours quotes and escaped quotes', () => {
    expect(splitCsvLine('a,"b,c","d""e",f')).toEqual(['a', 'b,c', 'd"e', 'f']);
    expect(splitCsvLine('')).toEqual(['']);
  });
});

describe('symbol rules (T-0125)', () => {
  it('accepts the documented shapes and rejects the rest', () => {
    for (const symbol of ['BTC', '^spx', 'xauusd', 'aapl.us', 'A=1_X-2.3', 'x'.repeat(20)]) {
      expect(PRICE_SYMBOL_PATTERN.test(symbol)).toBe(true);
    }
    for (const symbol of ['', 'has space', 'semi;colon', 'quote"hack', 'x'.repeat(21), 'uniçode']) {
      expect(PRICE_SYMBOL_PATTERN.test(symbol)).toBe(false);
    }
  });

  it('maps the built-in crypto table and nothing else', () => {
    expect(CRYPTO_IDS['BTC']).toBe('bitcoin');
    expect(CRYPTO_IDS['ETH']).toBe('ethereum');
    expect(CRYPTO_IDS['SOL']).toBe('solana');
    expect(CRYPTO_IDS['DOGE']).toBeDefined();
    expect(CRYPTO_IDS['FAKECOIN']).toBeUndefined();
  });
});
