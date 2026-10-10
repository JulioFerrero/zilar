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
  parseStooqCsv,
  PRICE_SYMBOL_PATTERN,
  stooqStamp,
  stooqUrl,
  STOOQ_HOST,
} from './prices';
import { guardedOptions, withWebRateLimit, type WebToolsState } from './shared';

// `web.price`: latest price per symbol, keyless. Tier 0: both hosts are
// fixed. Upper-cased crypto symbols go to CoinGecko; everything else
// goes to Stooq as-is (so `^spx`, `xauusd`, `aapl.us` keep working).
const webPriceArgsSchema = Schema.Struct({
  symbols: Schema.Array(Schema.String.check(Schema.isPattern(PRICE_SYMBOL_PATTERN))).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_PRICE_SYMBOLS),
  ),
});

export function webPriceAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.price',
    description: 'Latest price for crypto, stocks, indexes and gold (keyless).',
    tier: 0,
    argsSchema: webPriceArgsSchema as unknown as ArgsSchema<unknown>,
    describe: (args) => {
      const parsed = args as { symbols: string[] };
      return { summary: `Look up prices for ${parsed.symbols.join(', ')}` };
    },
    execute: withWebRateLimit(state, async (args) => {
      const parsed = args as { symbols: string[] };
      const cryptoSymbols: string[] = [];
      const cryptoIds: string[] = [];
      const stooqSymbols: string[] = [];
      for (const symbol of parsed.symbols) {
        const id = CRYPTO_IDS[symbol.toUpperCase()];
        if (id !== undefined) {
          cryptoSymbols.push(symbol);
          cryptoIds.push(id);
        } else {
          stooqSymbols.push(symbol);
        }
      }
      const lines: string[] = [];
      if (cryptoSymbols.length > 0) {
        const fetched = await guardedGet(
          coingeckoUrl(cryptoIds),
          guardedOptions(state, { allowedHosts: [COINGECKO_HOST], headers: { accept: '*/*' } }),
        );
        if (!fetched.ok) {
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
      if (stooqSymbols.length > 0) {
        const fetched = await guardedGet(
          stooqUrl(stooqSymbols),
          guardedOptions(state, { allowedHosts: [STOOQ_HOST], headers: { accept: '*/*' } }),
        );
        if (!fetched.ok) {
          for (const symbol of stooqSymbols) {
            lines.push(`${symbol} unavailable (${fetched.summary})`);
          }
        } else {
          const quotes = parseStooqCsv(fetched.body.text);
          for (const symbol of stooqSymbols) {
            const quote = quotes.get(symbol.toUpperCase());
            if (quote === undefined) {
              lines.push(`${symbol} unavailable (no quote, source stooq)`);
              continue;
            }
            lines.push(
              `${symbol} price ${quote.close} USD (as of ${stooqStamp(quote)}, source stooq)`,
            );
          }
        }
      }
      return {
        summary: `prices for ${parsed.symbols.length} symbol${parsed.symbols.length === 1 ? '' : 's'}`,
        modelText: lines.join('\n'),
      };
    }),
  };
}
