// T-0125: the five gateway-level web tools. Registered next to the
// tool adapters when `WEB_TOOLS_ENABLED=true`; nothing is registered
// when the flag is off. Untrusted content (pages, feeds, prices,
// search results) reaches the model only as `modelText` inside the
// gateway's `<untrusted-tool-output>` wrapper — never in a summary.
//
// Tiers follow the exfiltration rule: fixed-host adapters are tier 0
// (`web.wikipedia`, `web.price` — the caller cannot choose where the
// request goes), everything that fetches a caller-chosen URL or sends
// free text to a third party is tier 1 (`web.fetch`, `web.feed`,
// `web.search`).
import { z } from 'zod';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { serverVersion } from '../version';
import { parseFeed } from './feed';
import {
  guardedGet,
  truncateChars,
  type DnsLookup,
  type GuardedGetOptions,
  type PinnedFetcher,
} from './guarded-fetch';
import { extractText } from './html';
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
import {
  duckduckgoUrl,
  formatSearchResults,
  MAX_SEARCH_RESULTS,
  parseDuckDuckGo,
  SEARCH_HOST,
  searchUnavailableText,
  type WebSearchProvider,
  type WebSearchResult,
} from './search';

// At most 30 web actions per AI per topic per hour: a plain safety
// limit against runaway loops, not usage or cost tracking. The window
// is in memory only.
export const WEB_ACTIONS_PER_HOUR = 30;
export const WEB_ACTION_WINDOW_MS = 60 * 60 * 1000;

export const MAX_FETCH_URL_CHARS = 2048;
export const MAX_FETCH_CHARS = 16000;
export const DEFAULT_FETCH_CHARS = 8000;

export const MAX_FEED_LIMIT = 20;
export const DEFAULT_FEED_LIMIT = 10;

export const MAX_SEARCH_QUERY_CHARS = 200;

export const MAX_WIKIPEDIA_EXTRACT_CHARS = 3000;

export type WebSearchProviderName = 'duckduckgo-html' | 'none';

export interface BuildWebToolsAdaptersDeps {
  rateLimitNow?: () => number;
  dnsLookup?: DnsLookup;
  fetcher?: PinnedFetcher;
  searchProviderName?: WebSearchProviderName;
  searchProvider?: WebSearchProvider;
}

interface WebToolsState {
  webLimiter: RateLimiter;
  dnsLookup: DnsLookup | undefined;
  fetcher: PinnedFetcher | undefined;
  searchProviderName: WebSearchProviderName;
  searchProvider: WebSearchProvider;
}

// Builds the web adapters. `searchProvider: 'none'` unregisters
// `web.search`; everything else is always registered when enabled.
export function buildWebToolsAdapters(
  deps: BuildWebToolsAdaptersDeps = {},
): ActionAdapter<unknown>[] {
  const state = createWebToolsState(deps);
  const adapters: ActionAdapter<unknown>[] = [
    webFetchAdapter(state),
    webWikipediaAdapter(state),
    webPriceAdapter(state),
    webFeedAdapter(state),
  ];
  if (deps.searchProviderName !== 'none') {
    adapters.push(webSearchAdapter(state));
  }
  return adapters;
}

function createWebToolsState(deps: BuildWebToolsAdaptersDeps): WebToolsState {
  return {
    webLimiter: createRateLimiter({
      max: WEB_ACTIONS_PER_HOUR,
      windowMs: WEB_ACTION_WINDOW_MS,
      now: deps.rateLimitNow ?? Date.now,
    }),
    dnsLookup: deps.dnsLookup,
    fetcher: deps.fetcher,
    searchProviderName: deps.searchProviderName ?? 'duckduckgo-html',
    searchProvider: deps.searchProvider ?? duckduckgoProvider(deps.fetcher, deps.dnsLookup),
  };
}

function duckduckgoProvider(fetcher?: PinnedFetcher, dnsLookup?: DnsLookup): WebSearchProvider {
  return {
    search: async (query, options) => {
      const fetched = await guardedGet(duckduckgoUrl(query), {
        allowedHosts: [SEARCH_HOST],
        headers: { 'user-agent': wikipediaUserAgent(), accept: 'text/html' },
        ...(dnsLookup === undefined ? {} : { resolver: dnsLookup }),
        ...(fetcher === undefined ? {} : { fetcher }),
      });
      if (!fetched.ok) {
        return [];
      }
      return parseDuckDuckGo(fetched.body.text).slice(0, options.limit);
    },
  };
}

// Wikipedia's API etiquette asks for a descriptive User-Agent; the
// contact is deliberately vague (no personal address in code).
function wikipediaUserAgent(): string {
  return `Galena/${serverVersion} (self-hosted; contact via server admin)`;
}

// The shared gate for every web action. Counts all five actions in one
// (AI, topic) window; over the cap the adapter answers a plain summary
// line the model can read, without fetching.
function webRateLimitKey(ctx: ActionContext): string {
  return `${ctx.aiId}\n${ctx.groupId ?? ''}\n${ctx.topicId ?? ''}`;
}

function checkWebRateLimit(state: WebToolsState, ctx: ActionContext): string | null {
  if (!state.webLimiter.allow(webRateLimitKey(ctx))) {
    return 'web limit reached, try later';
  }
  return null;
}

function guardedOptions(
  state: WebToolsState,
  extra?: Partial<GuardedGetOptions>,
): GuardedGetOptions {
  return {
    allowedHosts: [],
    ...(state.dnsLookup === undefined ? {} : { resolver: state.dnsLookup }),
    ...(state.fetcher === undefined ? {} : { fetcher: state.fetcher }),
    ...extra,
  };
}

// `web.fetch`: read one caller-chosen page. Tier 1: the URL is a
// data-exfiltration channel, so the topic's "always allow here" rules
// and the kill switch apply.
const webFetchArgsSchema = z
  .object({
    url: z.string().min(1).max(MAX_FETCH_URL_CHARS),
    maxChars: z.number().int().min(1).max(MAX_FETCH_CHARS).optional(),
  })
  .strict();

function webFetchAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.fetch',
    description: 'Fetch one public https page and read it as plain text.',
    tier: 1,
    argsSchema: webFetchArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { url: string };
      return { summary: `Fetch ${hostOf(parsed.url)}` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { url: string; maxChars?: number };
      const limited = checkWebRateLimit(state, actionCtx);
      if (limited !== null) {
        return { summary: limited };
      }
      let host: string;
      try {
        host = new URL(parsed.url).hostname.toLowerCase();
      } catch {
        return { summary: 'invalid url' };
      }
      if (host.length === 0) {
        return { summary: 'invalid url' };
      }
      const maxChars = parsed.maxChars ?? DEFAULT_FETCH_CHARS;
      const fetched = await guardedGet(parsed.url, guardedOptions(state, { allowedHosts: [host] }));
      if (!fetched.ok) {
        return failureResult(fetched);
      }
      const text =
        fetched.body.contentType === 'text/html'
          ? extractText(fetched.body.text)
          : fetched.body.text.trim();
      if (text.length === 0) {
        return { summary: `fetched ${host} (empty page)` };
      }
      return {
        summary: `fetched ${host} (${Math.min(text.length, maxChars)} chars)`,
        modelText: truncateChars(text, maxChars),
      };
    },
  };
}

// `web.wikipedia`: search + page extract on a fixed host. Tier 0: the
// caller picks only the query and the language, never the host. `lang`
// is letters-only so it cannot smuggle a different host in.
const webWikipediaArgsSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    lang: z
      .string()
      .regex(/^[a-zA-Z]{2,3}$/, { message: 'lang must be 2-3 letters' })
      .optional(),
  })
  .strict();

export function wikipediaHost(lang: string): string {
  return `${lang.toLowerCase()}.wikipedia.org`;
}

const wikipediaSearchSchema = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string(), pageid: z.number().int() })),
  }),
});

const wikipediaExtractSchema = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({
        pageid: z.number().int().optional(),
        title: z.string(),
        extract: z.string().optional(),
        fullurl: z.string().optional(),
        missing: z.unknown().optional(),
      }),
    ),
  }),
});

export interface WikipediaArticle {
  title: string;
  extract: string;
  url: string;
}

export function parseWikipediaSearch(body: string): { title: string } | null {
  let parsed: z.infer<typeof wikipediaSearchSchema>;
  try {
    parsed = wikipediaSearchSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
  const first = parsed.query.search[0];
  if (first === undefined || first.title.trim().length === 0) {
    return null;
  }
  return { title: first.title };
}

export function parseWikipediaExtract(body: string): WikipediaArticle | null {
  let parsed: z.infer<typeof wikipediaExtractSchema>;
  try {
    parsed = wikipediaExtractSchema.parse(JSON.parse(body));
  } catch {
    return null;
  }
  const pages = Object.values(parsed.query.pages);
  const page = pages[0];
  if (page === undefined || page.missing !== undefined) {
    return null;
  }
  const extract = (page.extract ?? '').trim();
  if (extract.length === 0) {
    return null;
  }
  return {
    title: page.title,
    extract:
      extract.length <= MAX_WIKIPEDIA_EXTRACT_CHARS
        ? extract
        : `${extract.slice(0, MAX_WIKIPEDIA_EXTRACT_CHARS)}…`,
    url: page.fullurl ?? '',
  };
}

function wikipediaApiUrl(host: string, params: Record<string, string>): string {
  return `https://${host}/w/api.php?${new URLSearchParams({ format: 'json', ...params }).toString()}`;
}

function webWikipediaAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.wikipedia',
    description: 'Read a short Wikipedia summary of a topic (keyless, fixed host).',
    tier: 0,
    argsSchema: webWikipediaArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { query: string };
      return { summary: `Look up "${parsed.query}" on Wikipedia` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { query: string; lang?: string };
      const limited = checkWebRateLimit(state, actionCtx);
      if (limited !== null) {
        return { summary: limited };
      }
      const host = wikipediaHost(parsed.lang ?? 'en');
      const headers = { 'user-agent': wikipediaUserAgent(), accept: 'application/json' };
      const found = await guardedGet(
        wikipediaApiUrl(host, {
          action: 'query',
          list: 'search',
          srsearch: parsed.query,
          srlimit: '1',
          srprop: '',
        }),
        guardedOptions(state, { allowedHosts: [host], headers }),
      );
      if (!found.ok) {
        return { summary: found.summary };
      }
      const match = parseWikipediaSearch(found.body.text);
      if (match === null) {
        return { summary: 'no article found' };
      }
      const page = await guardedGet(
        wikipediaApiUrl(host, {
          action: 'query',
          prop: 'extracts|info',
          exintro: '1',
          explaintext: '1',
          inprop: 'url',
          redirects: '1',
          titles: match.title,
        }),
        guardedOptions(state, { allowedHosts: [host], headers }),
      );
      if (!page.ok) {
        return { summary: page.summary };
      }
      const article = parseWikipediaExtract(page.body.text);
      if (article === null) {
        return { summary: 'no article found' };
      }
      const urlLine = article.url.length > 0 ? `\n${article.url}` : '';
      return {
        summary: 'wikipedia article found',
        modelText: `${article.title}\n${article.extract}${urlLine}`,
      };
    },
  };
}

// `web.price`: latest price per symbol, keyless. Tier 0: both hosts are
// fixed. Upper-cased crypto symbols go to CoinGecko; everything else
// goes to Stooq as-is (so `^spx`, `xauusd`, `aapl.us` keep working).
const webPriceArgsSchema = z
  .object({
    symbols: z.array(z.string().regex(PRICE_SYMBOL_PATTERN)).min(1).max(MAX_PRICE_SYMBOLS),
  })
  .strict();

function webPriceAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.price',
    description: 'Latest price for crypto, stocks, indexes and gold (keyless).',
    tier: 0,
    argsSchema: webPriceArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { symbols: string[] };
      return { summary: `Look up prices for ${parsed.symbols.join(', ')}` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { symbols: string[] };
      const limited = checkWebRateLimit(state, actionCtx);
      if (limited !== null) {
        return { summary: limited };
      }
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
    },
  };
}

// `web.feed`: read one caller-chosen RSS/Atom feed. Tier 1: the URL is
// a data-exfiltration channel, like `web.fetch`.
const webFeedArgsSchema = z
  .object({
    url: z.string().min(1).max(MAX_FETCH_URL_CHARS),
    limit: z.number().int().min(1).max(MAX_FEED_LIMIT).optional(),
  })
  .strict();

export function formatFeedItems(
  items: { title: string; link: string; date: string; snippet: string }[],
): string {
  return items
    .map((item, index) => {
      const head = `${index + 1}. ${item.title.length > 0 ? item.title : '(no title)'}`;
      const link = item.link.length > 0 ? `\n   ${item.link}` : '';
      const date = item.date.length > 0 ? `\n   ${item.date}` : '';
      const snippet = item.snippet.length > 0 ? `\n   ${item.snippet}` : '';
      return `${head}${link}${date}${snippet}`;
    })
    .join('\n');
}

function webFeedAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.feed',
    description: 'Read the newest items of one public RSS or Atom feed.',
    tier: 1,
    argsSchema: webFeedArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { url: string };
      return { summary: `Read the feed at ${hostOf(parsed.url)}` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { url: string; limit?: number };
      const limited = checkWebRateLimit(state, actionCtx);
      if (limited !== null) {
        return { summary: limited };
      }
      let host: string;
      try {
        host = new URL(parsed.url).hostname.toLowerCase();
      } catch {
        return { summary: 'invalid url' };
      }
      if (host.length === 0) {
        return { summary: 'invalid url' };
      }
      const fetched = await guardedGet(parsed.url, guardedOptions(state, { allowedHosts: [host] }));
      if (!fetched.ok) {
        return failureResult(fetched);
      }
      const feed = parseFeed(fetched.body.text);
      if (!feed.ok) {
        return { summary: feed.summary };
      }
      const items = feed.items.slice(0, parsed.limit ?? DEFAULT_FEED_LIMIT);
      return {
        summary: `feed ${host} (${items.length} item${items.length === 1 ? '' : 's'})`,
        modelText: formatFeedItems(items),
      };
    },
  };
}

// `web.search`: best-effort search through the provider port. Tier 1:
// the query leaves the server, so the description warns the model not
// to put private or sensitive text in it. Any failure or 0 results is
// "search unavailable right now" with a hint at the reliable tools.
const webSearchArgsSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_SEARCH_QUERY_CHARS),
  })
  .strict();

function webSearchAdapter(state: WebToolsState): ActionAdapter<unknown> {
  return {
    name: 'web.search',
    description:
      'Best-effort web search (unreliable); never put private or sensitive text in the query.',
    tier: 1,
    argsSchema: webSearchArgsSchema as unknown as z.ZodType<unknown>,
    describe: (args) => {
      const parsed = args as { query: string };
      return { summary: `Search the web for "${parsed.query}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { query: string };
      const limited = checkWebRateLimit(state, actionCtx);
      if (limited !== null) {
        return { summary: limited };
      }
      // One attempt per call, never a retry loop: the provider returns
      // `[]` on any failure and the adapter answers "unavailable".
      let results: WebSearchResult[];
      try {
        results = await state.searchProvider.search(parsed.query, { limit: MAX_SEARCH_RESULTS });
      } catch {
        results = [];
      }
      if (results.length === 0) {
        return { summary: 'search unavailable right now', modelText: searchUnavailableText() };
      }
      return {
        summary: `search results for "${truncateChars(parsed.query, 80)}" (${results.length})`,
        modelText: formatSearchResults(parsed.query, results),
      };
    },
  };
}

// A failed get: the fixed summary, plus any text that came from the remote
// server (a redirect target) as `modelText` so it sits inside the untrusted
// block instead of the summary.
function failureResult(failed: { summary: string; detail?: string }): {
  summary: string;
  modelText?: string;
} {
  return failed.detail === undefined
    ? { summary: failed.summary }
    : { summary: failed.summary, modelText: failed.detail };
}

function hostOf(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.length > 0 ? host : 'that page';
  } catch {
    return 'that page';
  }
}
