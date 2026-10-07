import { Data, Effect, Exit, Schema, SchemaGetter, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';

/**
 * Message search (`GET /api/search`, T-0138). The mobile twin of the web
 * client in `apps/web/src/lib/api.ts`: the same wire contract
 * (`apps/server/src/search/routes.ts`).
 *
 * The boundary is validated with Effect Schema (T-0506 recipe): the request is
 * an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. Snippets arrive as plain text plus `marks` character
 * ranges; the client highlights with nested text and never renders HTML, like
 * web's `SearchSnippet`. Queries are never logged: they travel only in the
 * request URL the server deliberately does not log.
 */

export type SearchMark = [number, number];

export interface SearchItem {
  chatJid: string;
  messageId: string;
  senderName: string;
  at: string;
  snippet: string;
  marks: SearchMark[];
}

export interface SearchPage {
  items: SearchItem[];
  nextBefore?: string;
}

export interface SearchMessagesInput {
  q: string;
  chat?: string;
  limit?: number;
  before?: string;
  signal?: AbortSignal;
}

export interface SearchApi {
  searchMessages(input: SearchMessagesInput): Promise<SearchPage>;
}

export class SearchApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SearchApiError';
    this.status = status;
    this.code = code;
  }
}

// A mark is an integer character range, never negative; anything else rejects
// the whole page.
const MarkOffsetSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const SearchMarkSchema = Schema.mutable(Schema.Tuple([MarkOffsetSchema, MarkOffsetSchema]));

const SearchItemSchema = struct({
  chatJid: Schema.String,
  messageId: Schema.String,
  senderName: Schema.String,
  at: Schema.String,
  snippet: Schema.String,
  marks: Schema.mutable(Schema.Array(SearchMarkSchema)),
});

const SearchPageSchema = struct({
  items: Schema.mutable(Schema.Array(SearchItemSchema)),
  nextBefore: Schema.optional(Schema.String),
});

// The server's error envelope is decoded field by field, so a malformed `code`
// does not discard a valid `message` (and vice versa). A missing or malformed
// envelope keeps the fixed fallbacks used by `requestEffect`, as the old
// per-field guards did.
const LenientErrorStringSchema = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.String), {
    decode: SchemaGetter.transform((value) => (typeof value === 'string' ? value : undefined)),
    encode: SchemaGetter.transform((value) => value),
  }),
);

const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(LenientErrorStringSchema),
    message: Schema.optional(LenientErrorStringSchema),
  }),
});

function parseSearchPage(value: unknown): SearchPage | null {
  const decoded = Schema.decodeUnknownExit(SearchPageSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function searchParams(input: SearchMessagesInput): string {
  const params = new URLSearchParams();
  params.set('q', input.q);
  if (input.chat !== undefined && input.chat !== '') {
    params.set('chat', input.chat);
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.before !== undefined && input.before !== '') {
    params.set('before', input.before);
  }
  return params.toString();
}

// A helper (not a direct read) so TypeScript does not narrow `signal.aborted`
// to `false` after the first check: the signal can still fire mid-request.
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

// The internal failures, one per case. They carry no field beyond what the old
// `SearchApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message. An abort is not a search failure, so it
// carries the original `DOMException` back to the caller.
class SearchNetworkError extends Data.TaggedError('SearchNetworkError') {}
class SearchRequestError extends Data.TaggedError('SearchRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class SearchUnauthorized extends Data.TaggedError('SearchUnauthorized') {}
class SearchInvalidResponse extends Data.TaggedError('SearchInvalidResponse') {}
class SearchAborted extends Data.TaggedError('SearchAborted')<{
  readonly reason: DOMException;
}> {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  externalSignal: AbortSignal | undefined,
): EffectType.fn.Return<unknown, SearchNetworkError | SearchRequestError | SearchAborted> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal: externalSignal ?? signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: (cause) =>
      cause instanceof DOMException && cause.name === 'AbortError'
        ? new SearchAborted({ reason: cause })
        : new SearchNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const decoded = Schema.decodeUnknownExit(ErrorBodySchema)(body);
    const error = Exit.isSuccess(decoded) ? decoded.value.error : undefined;
    return yield* new SearchRequestError({
      status: response.status,
      code: error?.code ?? 'request_failed',
      message: error?.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `SearchApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createSearchApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): SearchApi {
  const searchEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
  ): EffectType.fn.Return<
    unknown,
    | SearchUnauthorized
    | SearchNetworkError
    | SearchRequestError
    | SearchInvalidResponse
    | SearchAborted
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new SearchUnauthorized();
    }
    if (isAborted(signal)) {
      return yield* new SearchAborted({ reason: new DOMException('Aborted', 'AbortError') });
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl, signal);
    if (isAborted(signal)) {
      return yield* new SearchAborted({ reason: new DOMException('Aborted', 'AbortError') });
    }
    const parsed = parseSearchPage(body);
    if (parsed === null) {
      return yield* new SearchInvalidResponse();
    }
    return parsed;
  });

  return {
    async searchMessages(input) {
      const body = await Effect.runPromise(
        searchEffect(`/api/search?${searchParams(input)}`, { method: 'GET' }, input.signal).pipe(
          Effect.catchTags({
            SearchUnauthorized: () =>
              Effect.fail(new SearchApiError(401, 'unauthorized', 'No session')),
            SearchNetworkError: () =>
              Effect.fail(new SearchApiError(0, 'network_error', 'Could not reach the server')),
            SearchRequestError: (error) =>
              Effect.fail(new SearchApiError(error.status, error.code, error.message)),
            SearchInvalidResponse: () =>
              Effect.fail(
                new SearchApiError(
                  200,
                  'invalid_response',
                  'The server sent an unexpected response',
                ),
              ),
            SearchAborted: (error) => Effect.fail(error.reason),
          }),
        ),
      );
      return body as SearchPage;
    },
  };
}
