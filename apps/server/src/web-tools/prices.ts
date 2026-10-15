// T-0125: keyless market prices. Two sources, one table in code:
//
// - crypto through CoinGecko's public "simple price" endpoint
//   (`GET https://api.coingecko.com/api/v3/simple/price?ids=<id>&vs_currencies=usd&include_last_updated_at=true`),
//   with a small built-in symbol table (`BTC→bitcoin`, `ETH→ethereum`,
//   …). A symbol with no row is reported as unknown, never guessed.
// - indexes, stocks, gold through Yahoo's chart endpoint
//   (`GET https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?range=1d&interval=1d`,
//   one request per symbol), reading `chart.result[0].meta`. Stooq's CSV
//   endpoint this replaced is gone (404/403).
//
// Both hosts are fixed. Every number must be finite or the symbol is
// reported as unavailable. No API key anywhere.
import { Schema } from 'effect';

export const COINGECKO_HOST = 'api.coingecko.com';
export const YAHOO_HOST = 'query1.finance.yahoo.com';

export const MAX_PRICE_SYMBOLS = 10;

export const PRICE_SYMBOL_PATTERN = /^[A-Za-z0-9.^=_-]{1,20}$/;

// The only crypto the adapter knows: anything else is reported as an
// unknown symbol so the model can retry it as a Yahoo symbol instead.
export const CRYPTO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  XRP: 'xrp',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  LTC: 'litecoin',
  DOT: 'polkadot',
};

export function coingeckoUrl(ids: string[]): string {
  const params = new URLSearchParams({
    ids: ids.join(','),
    vs_currencies: 'usd',
    include_last_updated_at: 'true',
  });
  return `https://${COINGECKO_HOST}/api/v3/simple/price?${params.toString()}`;
}

export function yahooUrl(symbol: string): string {
  return `https://${YAHOO_HOST}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
}

// Old Stooq spellings (and plain names the model reaches for) resolve to
// Yahoo tickers, case-insensitively and before the lookup. Anything else
// passes through; a Stooq-style `.us` suffix is dropped (`aapl.us` →
// `AAPL`).
const YAHOO_ALIASES: Record<string, string> = {
  SPX: '^GSPC',
  '^SPX': '^GSPC',
  SP500: '^GSPC',
  GOLD: 'GC=F',
  XAU: 'GC=F',
  XAUUSD: 'GC=F',
  SILVER: 'SI=F',
  XAG: 'SI=F',
  XAGUSD: 'SI=F',
  NDX: '^NDX',
  NASDAQ100: '^NDX',
  DJI: '^DJI',
  DOW: '^DJI',
};

// A human name for a Yahoo ticker that is not obvious, shown in the
// price line.
export const YAHOO_LABELS: Record<string, string> = {
  'GC=F': 'gold (COMEX futures)',
};

export function resolveYahooSymbol(input: string): string {
  const upper = input.toUpperCase();
  const alias = YAHOO_ALIASES[upper];
  if (alias !== undefined) {
    return alias;
  }
  if (upper.endsWith('.US') && upper.length > 3) {
    return upper.slice(0, -3);
  }
  return input;
}

const coingeckoSchema = Schema.Record(
  Schema.String,
  Schema.Struct({
    usd: Schema.Finite,
    last_updated_at: Schema.optional(
      Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
    ),
  }),
);

export interface PriceLine {
  symbol: string;
  line: string;
}

// CoinGecko: one line per id in request order. Unknown ids and
// non-finite prices say so in plain words.
export function coingeckoLines(
  symbols: string[],
  ids: string[],
  body: string,
): { lines: PriceLine[]; unknownIds: Set<string> } {
  let parsed: typeof coingeckoSchema.Type;
  try {
    parsed = Schema.decodeUnknownSync(coingeckoSchema)(JSON.parse(body));
  } catch {
    return {
      lines: symbols.map((symbol) => ({
        symbol,
        line: `${symbol} unavailable (source coingecko)`,
      })),
      unknownIds: new Set(),
    };
  }
  const lines: PriceLine[] = [];
  const unknownIds = new Set<string>();
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index] as string;
    const id = ids[index] as string;
    const row = parsed[id];
    if (row === undefined) {
      unknownIds.add(id);
      lines.push({ symbol, line: `${symbol} unknown symbol (not in the crypto table)` });
      continue;
    }
    const stamp =
      row.last_updated_at === undefined
        ? 'unknown'
        : new Date(row.last_updated_at * 1000).toISOString();
    lines.push({
      symbol,
      line: `${symbol} price ${row.usd} USD (as of ${stamp}, source coingecko)`,
    });
  }
  return { lines, unknownIds };
}

const yahooMetaSchema = Schema.Struct({
  regularMarketPrice: Schema.Finite,
  regularMarketTime: Schema.optional(Schema.Finite),
  currency: Schema.optional(Schema.String),
  symbol: Schema.optional(Schema.String),
});

const yahooChartSchema = Schema.Struct({
  chart: Schema.Struct({
    result: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ meta: yahooMetaSchema })))),
    error: Schema.optional(Schema.NullOr(Schema.Unknown)),
  }),
});

export interface YahooQuote {
  price: number;
  currency: string;
  time: number | undefined;
  symbol: string;
}

// Yahoo chart JSON: a non-null `chart.error`, a missing `result`, or a
// non-finite `regularMarketPrice` all mean "unavailable". `currency`
// falls back to USD, `symbol` to empty; `regularMarketTime` (unix
// seconds) is optional.
export function parseYahooChart(body: string): YahooQuote | null {
  let parsed: typeof yahooChartSchema.Type;
  try {
    parsed = Schema.decodeUnknownSync(yahooChartSchema)(JSON.parse(body));
  } catch {
    return null;
  }
  const error = parsed.chart.error;
  if (error !== null && error !== undefined) {
    return null;
  }
  const result = parsed.chart.result?.[0];
  if (result === undefined) {
    return null;
  }
  return {
    price: result.meta.regularMarketPrice,
    currency: result.meta.currency ?? 'USD',
    time: result.meta.regularMarketTime,
    symbol: result.meta.symbol ?? '',
  };
}
