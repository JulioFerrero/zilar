// T-0993: the `web.price` adapter, split out of `web-tools/adapters.ts` unchanged.
import { Schema } from 'effect';
import type { ActionAdapter, ArgsSchema } from '../actions/registry';
import { guardedGet } from './guarded-fetch';
import {
  COINGECKO_HOST,
  coingeckoLines,
  coingeckoUrl,
  CRYPTO_IDS,
  MAX_PRICE_SYMBOLS,
  parseYahooChart,
  PRICE_SYMBOL_PATTERN,
  resolveYahooSymbol,
  YAHOO_HOST,
  YAHOO_LABELS,
  yahooUrl,
} from './prices';
import { guardedOptions, withWebRateLimit, type WebToolsState } from './shared';

// `web.price`: latest price per symbol, keyless. Tier 0: both hosts are
// fixed. Upper-cased crypto symbols go to CoinGecko; every other symbol
// is aliased to a Yahoo ticker (the Stooq spellings, gold, the indexes)
// and fetched one request at a time.
const webPriceArgsSchema = Schema.Struct({
  symbols: Schema.Array(Schema.String.check(Schema.isPattern(PRICE_SYMBOL_PATTERN))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_PRICE_SYMBOLS),
  ),
});

// The HTTP status inside a guarded-fetch failure summary (`fetch failed
// with status 404`), or null for a failure that carries none (timeout,
// host not allowed). Fixed wording only, never page content.
function statusFromSummary(summary: string): number | null {
  const match = /status (\d{1,3})/.exec(summary);
  return match === null ? null : Number(match[1]);
}

// One warn line per failed provider request: the action, the fixed host
// and the status, never a URL, a symbol or response content.
function warnFetchFailure(state: WebToolsState, host: string, summary: string): void {
  state.logger.warn(
    { action: 'web.price', host, status: statusFromSummary(summary) },
    'web tool provider failed',
  );
}

function yahooStamp(quote: { time: number | undefined }): string {
  return quote.time === undefined ? 'unknown' : new Date(quote.time * 1000).toISOString();
}

export function webPriceAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.price',
    description: 'Latest price for crypto, stocks, indexes and gold (keyless).',
    tier: 0,
    argsExample: '{"symbols":["BTC","^GSPC","GC=F"]}',
    argsSchema: webPriceArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { symbols: string[] };
      return { summary: `Look up prices for ${parsed.symbols.join(', ')}` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { symbols: string[] };
      const cryptoSymbols: string[] = [];
      const cryptoIds: string[] = [];
      const yahooSymbols: string[] = [];
      for (const symbol of parsed.symbols) {
        const id = CRYPTO_IDS[symbol.toUpperCase()];
        if (id !== undefined) {
          cryptoSymbols.push(symbol);
          cryptoIds.push(id);
        } else {
          yahooSymbols.push(symbol);
        }
      }
      const lines: string[] = [];
      if (cryptoSymbols.length > 0) {
        const fetched = await guardedGet(
          coingeckoUrl(cryptoIds),
          guardedOptions(state, { allowedHosts: [COINGECKO_HOST], headers: { accept: '*/*' } }),
        );
        if (!fetched.ok) {
          warnFetchFailure(state, COINGECKO_HOST, fetched.summary);
          for (const symbol of cryptoSymbols) {
            lines.push(`${symbol} unavailable (${fetched.summary})`);
          }
        } else {
          const { lines: cryptoLines } = coingeckoLines(
            cryptoSymbols,
            cryptoIds,
            fetched.body.text,
          );
          for (const entry of cryptoLines) {
            lines.push(entry.line);
          }
        }
      }
      for (const symbol of yahooSymbols) {
        const resolved = resolveYahooSymbol(symbol);
        const fetched = await guardedGet(
          yahooUrl(resolved),
          guardedOptions(state, {
            allowedHosts: [YAHOO_HOST],
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; Zilar)', accept: '*/*' },
          }),
        );
        if (!fetched.ok) {
          warnFetchFailure(state, YAHOO_HOST, fetched.summary);
          lines.push(`${symbol} unavailable (${fetched.summary})`);
          continue;
        }
        const quote = parseYahooChart(fetched.body.text);
        if (quote === null) {
          lines.push(`${symbol} unavailable (no quote, source yahoo)`);
          continue;
        }
        const label = YAHOO_LABELS[resolved];
        const labelSuffix = label === undefined ? '' : `, ${label}`;
        lines.push(
          `${symbol} price ${quote.price} ${quote.currency} (as of ${yahooStamp(quote)}, source yahoo${labelSuffix})`,
        );
      }
      return {
        summary: `prices for ${parsed.symbols.length} symbol${parsed.symbols.length === 1 ? '' : 's'}`,
        modelText: lines.join('\n'),
      };
    }),
  };
}
