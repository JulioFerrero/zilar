// DeepSeek's own Search and Fetch APIs, called with the AI's direct DeepSeek key.
// A request is billed only when search returns results or fetch returns content.
import { Duration, Effect, Exit, Schema } from 'effect';
import type { FetchLike } from '../ai/http';
import { MAX_SEARCH_RESULTS, type WebSearchResult } from './search';

export const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';
export const DEEPSEEK_FETCH_URL = 'https://api.deepseek.com/v1/tools/fetch';

const SEARCH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_QUERY_CHARS = 128;

export interface DeepSeekLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
}

export interface DeepSeekOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  logger?: DeepSeekLogger;
}

export type DeepSeekSearchOutcome =
  { ok: true; results: WebSearchResult[] } | { ok: false; summary: string };

export type DeepSeekFetchOutcome =
  { ok: true; title: string; content: string } | { ok: false; summary: string };

const searchResponseSchema = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      title: Schema.optional(Schema.NullOr(Schema.String)),
      url: Schema.optional(Schema.NullOr(Schema.String)),
      snippet: Schema.optional(Schema.NullOr(Schema.String)),
      summary: Schema.optional(Schema.NullOr(Schema.String)),
      date: Schema.optional(Schema.NullOr(Schema.String)),
      site_name: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
});

const fetchResponseSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.NullOr(Schema.String)),
});

export async function deepseekSearch(
  key: string,
  query: string,
  options: DeepSeekOptions = {},
): Promise<DeepSeekSearchOutcome> {
  return Effect.runPromise(searchEffect(key, query, options));
}

export async function deepseekFetch(
  key: string,
  url: string,
  options: DeepSeekOptions = {},
): Promise<DeepSeekFetchOutcome> {
  return Effect.runPromise(fetchEffect(key, url, options));
}

function searchEffect(
  key: string,
  query: string,
  options: DeepSeekOptions,
): Effect.Effect<DeepSeekSearchOutcome> {
  return Effect.gen(function* () {
    const reply = yield* postJson(
      DEEPSEEK_SEARCH_URL,
      key,
      { query: query.slice(0, MAX_QUERY_CHARS), count: MAX_SEARCH_RESULTS },
      SEARCH_TIMEOUT_MS,
      options,
    );
    if (!reply.ok) {
      return { ok: false, summary: searchFailure(reply.status) };
    }
    const decoded = Schema.decodeUnknownExit(searchResponseSchema)(reply.body);
    if (!Exit.isSuccess(decoded)) {
      return { ok: false, summary: 'search failed' };
    }
    return { ok: true, results: mapResults(decoded.value.results) };
  });
}

function fetchEffect(
  key: string,
  url: string,
  options: DeepSeekOptions,
): Effect.Effect<DeepSeekFetchOutcome> {
  return Effect.gen(function* () {
    const reply = yield* postJson(DEEPSEEK_FETCH_URL, key, { url }, FETCH_TIMEOUT_MS, options);
    if (!reply.ok) {
      return { ok: false, summary: fetchFailure(reply.status) };
    }
    const decoded = Schema.decodeUnknownExit(fetchResponseSchema)(reply.body);
    if (!Exit.isSuccess(decoded)) {
      return { ok: false, summary: 'no readable content' };
    }
    const content = decoded.value.content ?? '';
    if (content.trim().length === 0) {
      return { ok: false, summary: 'no readable content' };
    }
    return { ok: true, title: decoded.value.title ?? '', content };
  });
}

// `summary` is written for models; `snippet` is the fallback.
function mapResults(
  rows: ReadonlyArray<{
    title?: string | null | undefined;
    url?: string | null | undefined;
    snippet?: string | null | undefined;
    summary?: string | null | undefined;
    date?: string | null | undefined;
    site_name?: string | null | undefined;
  }>,
): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const row of rows) {
    const title = row.title ?? '';
    const url = row.url ?? '';
    if (title.length === 0 || !/^https?:\/\//i.test(url)) {
      continue;
    }
    const summary = row.summary ?? '';
    const snippet = summary.length > 0 ? summary : (row.snippet ?? '');
    const date = row.date ?? '';
    const site = row.site_name ?? '';
    results.push({
      title,
      url,
      snippet,
      ...(date.length === 0 ? {} : { date }),
      ...(site.length === 0 ? {} : { site }),
    });
  }
  return results;
}

type PostOutcome = { ok: true; body: unknown } | { ok: false; status: number | null };

function postJson(
  url: string,
  key: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  options: DeepSeekOptions,
): Effect.Effect<PostOutcome> {
  return Effect.gen(function* () {
    // `Effect.tryPromise` hands the fetch an `AbortSignal` that fires on
    // interruption; the timeout keeps only the typed outcome.
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        (options.fetchImpl ?? fetch)(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: options.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
        }),
      catch: () => null,
    }).pipe(
      Effect.catchCause(() => Effect.succeed(null)),
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () => Effect.succeed(null),
      }),
    );
    if (response === null) {
      // The key, the payload and any response text stay out of the log line.
      options.logger?.warn({ status: null }, 'DeepSeek request failed');
      return { ok: false, status: null } as const;
    }
    if (response.status !== 200) {
      options.logger?.warn({ status: response.status }, 'DeepSeek request failed');
      return { ok: false, status: response.status } as const;
    }
    return { ok: true, body: yield* readJson(response) } as const;
  });
}

function readJson(response: Response): Effect.Effect<unknown> {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: () => undefined,
  }).pipe(Effect.catchCause(() => Effect.succeed(undefined)));
}

function searchFailure(status: number | null): string {
  switch (status) {
    case 401:
      return 'DeepSeek key rejected';
    case 402:
      return 'DeepSeek balance is empty';
    case 403:
      return 'search refused by DeepSeek';
    case 408:
    case 429:
      return 'search busy, try later';
    default:
      return status !== null && status >= 500 ? 'search busy, try later' : 'search failed';
  }
}

function fetchFailure(status: number | null): string {
  switch (status) {
    case 401:
      return 'DeepSeek key rejected';
    case 402:
      return 'DeepSeek balance is empty';
    case 403:
      return 'page refused by DeepSeek';
    case 404:
      return 'no readable content';
    case 408:
    case 429:
      return 'fetch busy, try later';
    default:
      return status !== null && status >= 500 ? 'fetch busy, try later' : 'fetch failed';
  }
}
