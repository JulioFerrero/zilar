// effect-plain: the shared state, constants and helpers for the web adapters.
import type { ActionContext, ActionResult } from '../actions/registry';
import type { FetchLike } from '../ai/http';
import { limiter, type RateLimiter } from '../rate-limit';
import { serverVersion } from '../version';
import {
  guardedGet,
  type DnsLookup,
  type GuardedGetOptions,
  type PinnedFetcher,
} from './guarded-fetch';
import { duckduckgoUrl, parseDuckDuckGo, SEARCH_HOST, type WebSearchProvider } from './search';
import type { WebSource } from './sources';

export const MAX_FETCH_URL_CHARS = 2048;
export const MAX_FETCH_CHARS = 16000;
export const DEFAULT_FETCH_CHARS = 8000;

export const MAX_FEED_LIMIT = 20;
export const DEFAULT_FEED_LIMIT = 10;

export const MAX_SEARCH_QUERY_CHARS = 200;

export const MAX_WIKIPEDIA_EXTRACT_CHARS = 3000;

export type WebSearchProviderName = 'duckduckgo-html' | 'none';

// One structured warn line per provider failure; a no-op when none is passed.
export interface WebToolsLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface BuildWebToolsAdaptersDeps {
  rateLimitNow?: () => number;
  dnsLookup?: DnsLookup;
  fetcher?: PinnedFetcher;
  searchProviderName?: WebSearchProviderName;
  searchProvider?: WebSearchProvider;
  logger?: WebToolsLogger;
  webSourceFor?: (aiId: string, need: 'search' | 'read') => Promise<WebSource | null>;
  sourceFetch?: FetchLike;
  recordToolCost?: (aiId: string, costUsd: number) => void;
}

export interface WebToolsState {
  webLimiter: RateLimiter;
  dnsLookup: DnsLookup | undefined;
  fetcher: PinnedFetcher | undefined;
  searchProviderName: WebSearchProviderName;
  searchProvider: WebSearchProvider;
  logger: WebToolsLogger;
  webSourceFor: ((aiId: string, need: 'search' | 'read') => Promise<WebSource | null>) | undefined;
  sourceFetch: FetchLike | undefined;
  recordToolCost: ((aiId: string, costUsd: number) => void) | undefined;
}

export function createWebToolsState(deps: BuildWebToolsAdaptersDeps): WebToolsState {
  return {
    webLimiter: limiter('webActionsPerHour', deps.rateLimitNow ?? Date.now),
    dnsLookup: deps.dnsLookup,
    fetcher: deps.fetcher,
    searchProviderName: deps.searchProviderName ?? 'duckduckgo-html',
    searchProvider: deps.searchProvider ?? duckduckgoProvider(deps.fetcher, deps.dnsLookup),
    logger: deps.logger ?? { warn: () => {} },
    webSourceFor: deps.webSourceFor,
    sourceFetch: deps.sourceFetch,
    recordToolCost: deps.recordToolCost,
  };
}

export function duckduckgoProvider(
  fetcher?: PinnedFetcher,
  dnsLookup?: DnsLookup,
): WebSearchProvider {
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

// The API asks for a descriptive User-Agent; no personal address in code.
export function wikipediaUserAgent(): string {
  return `Zilar/${serverVersion} (self-hosted; contact via server admin)`;
}

// One (AI, topic) window for all five actions; over the cap the adapter answers a
// plain summary line without fetching.
function webRateLimitKey(ctx: ActionContext): string {
  return `${ctx.aiId}\n${ctx.groupId ?? ''}\n${ctx.topicId ?? ''}`;
}

export function withWebRateLimit(
  state: WebToolsState,
  fn: (args: unknown, ctx: ActionContext) => Promise<ActionResult>,
): (ctx: unknown, args: unknown) => Promise<ActionResult> {
  return async (ctx, args) => {
    const actionCtx = ctx as ActionContext;
    if (!state.webLimiter.allow(webRateLimitKey(actionCtx))) {
      return { summary: 'web limit reached, try later' };
    }
    return fn(args, actionCtx);
  };
}

export function guardedOptions(
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

// Remote text (a redirect target) goes to `modelText`, inside the untrusted block.
export function failureResult(failed: { summary: string; detail?: string }): {
  summary: string;
  modelText?: string;
} {
  return failed.detail === undefined
    ? { summary: failed.summary }
    : { summary: failed.summary, modelText: failed.detail };
}

export function hostOf(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.length > 0 ? host : 'that page';
  } catch {
    return 'that page';
  }
}
