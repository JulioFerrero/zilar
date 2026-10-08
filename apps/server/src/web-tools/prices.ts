// T-0125: keyless market prices. Two sources, one table in code:
//
// - crypto through CoinGecko's public "simple price" endpoint
//   (`GET https://api.coingecko.com/api/v3/simple/price?ids=<id>&vs_currencies=usd&include_last_updated_at=true`),
//   with a small built-in symbol table (`BTC→bitcoin`, `ETH→ethereum`,
//   …). A symbol with no row is reported as unknown, never guessed.
// - indexes, stocks, gold through Stooq's public CSV quote endpoint
//   (`GET https://stooq.com/q/l/?s=<s>&f=sd2t2ohlcv&h&e=csv`, one row per
//   symbol: `Symbol,Date,Time,Open,High,Low,Close,Volume`), parsed with a
//   strict CSV line parser. `N/D` and empty fields mean "no quote".
//
// Both hosts are fixed. Every number must be finite or the symbol is
// reported as unavailable. No API key anywhere.
import { Exit, Schema } from 'effect';

export const COINGECKO_HOST = 'api.coingecko.com';
export const STOOQ_HOST = 'stooq.com';

export const MAX_PRICE_SYMBOLS = 10;

export const PRICE_SYMBOL_PATTERN = /^[A-Za-z0-9.^=_-]{1,20}$/;

// The only crypto the adapter knows: anything else is reported as an
// unknown symbol so the model can retry it as a Stooq symbol instead.
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

export function stooqUrl(symbols: string[]): string {
  const params = new URLSearchParams({
    s: symbols.join(','),
    f: 'sd2t2ohlcv',
    h: '',
    e: 'csv',
  });
  return `https://${STOOQ_HOST}/q/l/?${params.toString()}`;
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

const stooqRowSchema = Schema.Struct({
  symbol: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  date: Schema.String,
  time: Schema.String,
  close: Schema.Finite,
});

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

export interface StooqQuote {
  symbol: string;
  date: string;
  time: string;
  close: number;
}

// Stooq CSV: header `Symbol,Date,Time,Open,High,Low,Close,Volume`, one
// row per symbol. `N/D`, empty and non-finite closes are unavailable,
// never zero. Rows keyed by upper-cased symbol; the first data row wins.
export function parseStooqCsv(body: string): Map<string, StooqQuote> {
  const quotes = new Map<string, StooqQuote>();
  const lines = body.split(/\r?\n/);
  if (lines.length < 2) {
    return quotes;
  }
  const header = splitCsvLine(lines[0] ?? '');
  const columns = new Map(header.map((name, index) => [name.trim().toLowerCase(), index]));
  const at = (row: string[], name: string): string | null => {
    const index = columns.get(name);
    if (index === undefined || index >= row.length) {
      return null;
    }
    return (row[index] ?? '').trim();
  };
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) {
      continue;
    }
    const row = splitCsvLine(line);
    const symbol = at(row, 'symbol');
    const closeRaw = at(row, 'close');
    if (symbol === null || symbol.length === 0 || closeRaw === null || closeRaw.length === 0) {
      continue;
    }
    if (/^n\/d$/i.test(closeRaw)) {
      continue;
    }
    const close = Number(closeRaw);
    if (!Number.isFinite(close)) {
      continue;
    }
    const key = symbol.toUpperCase();
    if (quotes.has(key)) {
      continue;
    }
    const checked = Schema.decodeUnknownExit(stooqRowSchema)({
      symbol,
      date: at(row, 'date') ?? '',
      time: at(row, 'time') ?? '',
      close,
    });
    if (!Exit.isSuccess(checked)) {
      continue;
    }
    quotes.set(key, checked.value);
  }
  return quotes;
}

// One comma-separated line, honouring double-quoted fields and `""`
// escapes. Unclosed quotes read to end of line; never throws.
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  let pos = 0;
  while (pos < line.length) {
    const char = line[pos] as string;
    if (quoted) {
      if (char === '"') {
        if (line[pos + 1] === '"') {
          field += '"';
          pos += 2;
          continue;
        }
        quoted = false;
        pos += 1;
        continue;
      }
      field += char;
      pos += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      pos += 1;
      continue;
    }
    if (char === ',') {
      fields.push(field);
      field = '';
      pos += 1;
      continue;
    }
    field += char;
    pos += 1;
  }
  fields.push(field);
  return fields;
}

export function stooqStamp(quote: { date: string; time: string }): string {
  const stamp =
    quote.date.length > 0 ? `${quote.date}${quote.time.length > 0 ? ` ${quote.time}` : ''}` : '';
  return stamp.length === 0 ? 'unknown' : stamp;
}
