// Web search and page read sources: DeepSeek's own tools and the keyed
// providers an AI's owner can connect. A request is billed only when search
// returns results or fetch returns content; a provider key bills its owner.
import { Duration, Effect, Exit, Schema } from 'effect';
import type { FetchLike } from '../ai/http';
import { stripTags } from '../markup/scan';
import { MAX_SEARCH_RESULTS, type WebSearchResult } from './search';

export const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search';
export const DEEPSEEK_FETCH_URL = 'https://api.deepseek.com/v1/tools/fetch';

const SEARCH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_QUERY_CHARS = 128;
const DEEPSEEK_TOOL_COST_USD = 0.00075;

export type SourceLogger = { warn(fields: Record<string, unknown>, message: string): void };

export interface SourceOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  logger?: SourceLogger;
}

export type SearchOutcome =
  { ok: true; results: WebSearchResult[] } | { ok: false; summary: string };

export type ReadOutcome =
  { ok: true; title: string; content: string } | { ok: false; summary: string };

export interface WebSource {
  provider: string;
  label: string;
  costUsd?: number;
  search?: (query: string, options: SourceOptions) => Promise<SearchOutcome>;
  read?: (url: string, options: SourceOptions) => Promise<ReadOutcome>;
}

const NullableString = Schema.optional(Schema.NullOr(Schema.String));

const SearchRow = Schema.Struct({
  title: NullableString,
  url: NullableString,
  snippet: NullableString,
  summary: NullableString,
  description: NullableString,
  content: NullableString,
  highlights: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  date: NullableString,
  site_name: NullableString,
});
type SearchRow = Schema.Schema.Type<typeof SearchRow>;

const ReadRow = Schema.Struct({
  title: NullableString,
  content: NullableString,
  text: NullableString,
  markdown: NullableString,
  raw_content: NullableString,
  metadata: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        title: Schema.optional(
          Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
        ),
      }),
    ),
  ),
});
type ReadRow = Schema.Schema.Type<typeof ReadRow>;

interface SearchSpec {
  url: string | ((query: string) => string);
  method: 'GET' | 'POST';
  body?: (query: string) => Record<string, unknown>;
  rows: (body: unknown) => unknown;
  snippet: (row: SearchRow) => string;
}

interface ReadSpec {
  url: (url: string) => string;
  method: 'GET' | 'POST';
  body?: (url: string) => Record<string, unknown>;
  pick?: (body: unknown) => unknown;
  title: (row: ReadRow) => string;
  content: (row: ReadRow) => string;
}

interface SourceSpec {
  label: string;
  auth: string;
  costUsd?: number;
  rejectedStatuses?: readonly number[];
  search?: SearchSpec;
  read?: ReadSpec;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowsAt(body: unknown, ...path: string[]): unknown {
  let current: unknown = body;
  for (const key of path) {
    const parent = record(current);
    if (parent === null) {
      return undefined;
    }
    const next = parent[key];
    if (next === undefined || next === null) {
      return [];
    }
    current = next;
  }
  return current;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

const SOURCES: Record<string, SourceSpec> = {
  deepseek: {
    label: 'DeepSeek',
    auth: 'authorization',
    costUsd: DEEPSEEK_TOOL_COST_USD,
    search: {
      url: DEEPSEEK_SEARCH_URL,
      method: 'POST',
      body: (query) => ({ query: query.slice(0, MAX_QUERY_CHARS), count: MAX_SEARCH_RESULTS }),
      rows: (body) => record(body)?.results,
      snippet: (row) => {
        const summary = row.summary ?? '';
        return summary.length > 0 ? summary : (row.snippet ?? '');
      },
    },
    read: {
      url: () => DEEPSEEK_FETCH_URL,
      method: 'POST',
      body: (url) => ({ url }),
      title: (row) => row.title ?? '',
      content: (row) => row.content ?? '',
    },
  },
  brave: {
    label: 'Brave Search',
    auth: 'x-subscription-token',
    rejectedStatuses: [422],
    search: {
      url: (query) => {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('count', String(MAX_SEARCH_RESULTS));
        return url.toString();
      },
      method: 'GET',
      rows: (body) => rowsAt(body, 'web', 'results'),
      snippet: (row) => stripTags(row.description ?? '').trim(),
    },
  },
  exa: {
    label: 'Exa',
    auth: 'x-api-key',
    search: {
      url: 'https://api.exa.ai/search',
      method: 'POST',
      body: (query) => ({
        query,
        numResults: MAX_SEARCH_RESULTS,
        contents: { highlights: true },
      }),
      rows: (body) => rowsAt(body, 'results'),
      snippet: (row) => (row.highlights ?? []).join(' … '),
    },
    read: {
      url: () => 'https://api.exa.ai/contents',
      method: 'POST',
      body: (url) => ({ urls: [url], text: true }),
      pick: (body) => first(record(body)?.results),
      title: (row) => row.title ?? '',
      content: (row) => row.text ?? '',
    },
  },
  firecrawl: {
    label: 'Firecrawl',
    auth: 'authorization',
    search: {
      url: 'https://api.firecrawl.dev/v2/search',
      method: 'POST',
      body: (query) => ({ query, limit: MAX_SEARCH_RESULTS }),
      rows: (body) => rowsAt(body, 'data', 'web'),
      snippet: (row) => row.description ?? '',
    },
    read: {
      url: () => 'https://api.firecrawl.dev/v2/scrape',
      method: 'POST',
      body: (url) => ({ url, formats: ['markdown'] }),
      pick: (body) => record(body)?.data,
      title: (row) => {
        const title = row.metadata?.title;
        return Array.isArray(title) ? (title[0] ?? '') : (title ?? '');
      },
      content: (row) => row.markdown ?? '',
    },
  },
  jina: {
    label: 'Jina',
    auth: 'authorization',
    search: {
      url: (query) => `https://s.jina.ai/?${new URLSearchParams({ q: query }).toString()}`,
      method: 'GET',
      rows: (body) => rowsAt(body, 'data'),
      snippet: (row) => {
        const description = row.description ?? '';
        return description.length > 0 ? description : (row.content ?? '').slice(0, 300);
      },
    },
    read: {
      url: (url) => `https://r.jina.ai/${url}`,
      method: 'GET',
      pick: (body) => record(body)?.data,
      title: (row) => row.title ?? '',
      content: (row) => row.content ?? '',
    },
  },
  tavily: {
    label: 'Tavily',
    auth: 'authorization',
    search: {
      url: 'https://api.tavily.com/search',
      method: 'POST',
      body: (query) => ({ query, max_results: MAX_SEARCH_RESULTS }),
      rows: (body) => rowsAt(body, 'results'),
      snippet: (row) => row.content ?? '',
    },
    read: {
      url: () => 'https://api.tavily.com/extract',
      method: 'POST',
      body: (url) => ({ urls: [url] }),
      pick: (body) => first(record(body)?.results),
      title: () => '',
      content: (row) => row.raw_content ?? '',
    },
  },
};

export function webSource(provider: string, key: string): WebSource | null {
  const spec = SOURCES[provider];
  if (spec === undefined) {
    return null;
  }
  const { search, read } = spec;
  const source: WebSource = { provider, label: spec.label };
  if (spec.costUsd !== undefined) {
    source.costUsd = spec.costUsd;
  }
  if (search !== undefined) {
    source.search = (query, options) => runSearch(spec, search, key, query, options);
  }
  if (read !== undefined) {
    source.read = (url, options) => runRead(spec, read, key, url, options);
  }
  return source;
}

interface RequestSpec {
  label: string;
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs: number;
  /** Extra statuses this provider uses for a rejected key beyond 401/403. */
  rejectedStatuses?: readonly number[];
}

type RequestOutcome = { ok: true; body: unknown } | { ok: false; status: number | null };

function headersFor(auth: string, key: string, method: 'GET' | 'POST'): Record<string, string> {
  const value = auth === 'authorization' ? `Bearer ${key}` : key;
  return {
    [auth]: value,
    ...(method === 'POST'
      ? { 'content-type': 'application/json' }
      : { accept: 'application/json' }),
  };
}

function requestSpec(
  entry: SourceSpec,
  key: string,
  request: {
    url: string;
    method: 'GET' | 'POST';
    body?: Record<string, unknown>;
    timeoutMs: number;
  },
): RequestSpec {
  return {
    label: entry.label,
    url: request.url,
    method: request.method,
    headers: headersFor(entry.auth, key, request.method),
    ...(request.body === undefined ? {} : { body: request.body }),
    timeoutMs: request.timeoutMs,
    ...(entry.rejectedStatuses === undefined ? {} : { rejectedStatuses: entry.rejectedStatuses }),
  };
}

function runSearch(
  entry: SourceSpec,
  search: SearchSpec,
  key: string,
  query: string,
  options: SourceOptions,
): Promise<SearchOutcome> {
  const body = search.body?.(query);
  const spec = requestSpec(entry, key, {
    url: typeof search.url === 'string' ? search.url : search.url(query),
    method: search.method,
    timeoutMs: SEARCH_TIMEOUT_MS,
    ...(body === undefined ? {} : { body }),
  });
  return Effect.runPromise(
    Effect.gen(function* () {
      const reply = yield* requestJson(spec, options);
      if (!reply.ok) {
        return { ok: false, summary: failureText(spec, 'search', reply.status) } as const;
      }
      const rows = decode(Schema.Array(SearchRow), search.rows(reply.body));
      if (rows === null) {
        return { ok: false, summary: 'search failed' } as const;
      }
      const results: WebSearchResult[] = [];
      for (const row of rows) {
        const title = row.title ?? '';
        const url = row.url ?? '';
        if (title.length === 0 || !/^https?:\/\//i.test(url)) {
          continue;
        }
        const date = row.date ?? '';
        const site = row.site_name ?? '';
        results.push({
          title,
          url,
          snippet: search.snippet(row),
          ...(date.length === 0 ? {} : { date }),
          ...(site.length === 0 ? {} : { site }),
        });
      }
      return { ok: true, results } as const;
    }),
  );
}

function runRead(
  entry: SourceSpec,
  read: ReadSpec,
  key: string,
  url: string,
  options: SourceOptions,
): Promise<ReadOutcome> {
  const body = read.body?.(url);
  const spec = requestSpec(entry, key, {
    url: read.url(url),
    method: read.method,
    timeoutMs: FETCH_TIMEOUT_MS,
    ...(body === undefined ? {} : { body }),
  });
  return Effect.runPromise(
    Effect.gen(function* () {
      const reply = yield* requestJson(spec, options);
      if (!reply.ok) {
        return { ok: false, summary: failureText(spec, 'fetch', reply.status) } as const;
      }
      const decoded = decode(ReadRow, read.pick === undefined ? reply.body : read.pick(reply.body));
      if (decoded === null) {
        return { ok: false, summary: 'no readable content' } as const;
      }
      const content = read.content(decoded);
      if (content.trim().length === 0) {
        return { ok: false, summary: 'no readable content' } as const;
      }
      return { ok: true, title: read.title(decoded), content } as const;
    }),
  );
}

function requestJson(spec: RequestSpec, options: SourceOptions): Effect.Effect<RequestOutcome> {
  return Effect.gen(function* () {
    // `Effect.tryPromise` hands the fetch an `AbortSignal` that fires on
    // interruption; the timeout keeps only the typed outcome.
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        (options.fetchImpl ?? fetch)(spec.url, {
          method: spec.method,
          headers: spec.headers,
          ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
          signal: options.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
        }),
      catch: () => null,
    }).pipe(
      Effect.catchCause(() => Effect.succeed(null)),
      Effect.timeoutOrElse({
        duration: Duration.millis(spec.timeoutMs),
        orElse: () => Effect.succeed(null),
      }),
    );
    if (response === null) {
      // The key, the payload and any response text stay out of the log line.
      options.logger?.warn({ status: null }, `${spec.label} request failed`);
      return { ok: false, status: null } as const;
    }
    if (!response.ok) {
      options.logger?.warn({ status: response.status }, `${spec.label} request failed`);
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

function decode<A>(schema: Schema.ConstraintDecoder<A, never>, body: unknown): A | null {
  const decoded = Schema.decodeUnknownExit(schema)(body);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function failureText(spec: RequestSpec, kind: 'search' | 'fetch', status: number | null): string {
  if (
    status !== null &&
    (status === 401 || status === 403 || (spec.rejectedStatuses ?? []).includes(status))
  ) {
    return `${spec.label} key rejected`;
  }
  if (status === 402) {
    return `${spec.label} balance is empty`;
  }
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return `${kind} busy, try later`;
  }
  return `${kind} failed`;
}
