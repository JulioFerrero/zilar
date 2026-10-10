// effect-plain: moved unchanged from apps/server/src/web-tools/adapters.ts (size split)
// T-0993: the shared state, constants and helpers for the web-tool
// adapters, split out of `web-tools/adapters.ts` unchanged.
import type { ActionContext, ActionResult } from '../actions/registry';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { serverVersion } from '../version';
import {
  guardedGet,
  type DnsLookup,
  type GuardedGetOptions,
  type PinnedFetcher,
} from './guarded-fetch';
import { duckduckgoUrl, parseDuckDuckGo, SEARCH_HOST, type WebSearchProvider } from './search';

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

export interface WebToolsState {
  webLimiter: RateLimiter;
  dnsLookup: DnsLookup | undefined;
  fetcher: PinnedFetcher | undefined;
  searchProviderName: WebSearchProviderName;
  searchProvider: WebSearchProvider;
}

export function createWebToolsState(deps: BuildWebToolsAdaptersDeps): WebToolsState {
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

// Wikipedia's API etiquette asks for a descriptive User-Agent; the
// contact is deliberately vague (no personal address in code).
export function wikipediaUserAgent(): string {
  return `Zilar/${serverVersion} (self-hosted; contact via server admin)`;
}

// The shared gate for every web action. Counts all five actions in one
// (AI, topic) window; over the cap the adapter answers a plain summary
// line the model can read, without fetching.
function webRateLimitKey(ctx: ActionContext): string {
  return `${ctx.aiId}\n${ctx.groupId ?? ''}\n${ctx.topicId ?? ''}`;
}

export function withWebRateLimit(
  state: WebToolsState,
  fn: (args: unknown) => Promise<ActionResult>,
): (ctx: unknown, args: unknown) => Promise<ActionResult> {
  return async (ctx, args) => {
    const actionCtx = ctx as ActionContext;
    if (!state.webLimiter.allow(webRateLimitKey(actionCtx))) {
      return { summary: 'web limit reached, try later' };
    }
    return fn(args);
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

// A failed get: the fixed summary, plus any text that came from the remote
// server (a redirect target) as `modelText` so it sits inside the untrusted
// block instead of the summary.
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
