import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import type { GifItem } from './gifs';

/**
 * The GIF search client (T-0148), the mobile twin of the web GIF calls in
 * `apps/web/src/lib/api.ts`: `GET /api/gifs/search?q=&pos=`,
 * `GET /api/gifs/trending?pos=`. Results carry opaque `mediaToken`s, never
 * provider URLs; previews and the send path load through the same-origin
 * proxy (`/api/gifs/media/:token`).
 *
 * The boundary is validated with Effect Schema (T-0527, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. Malformed rows are dropped, never rendered. Queries
 * are never logged.
 */

export class GifsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GifsApiError';
    this.status = status;
    this.code = code;
  }
}

const GifItemSchema = struct({
  id: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  title: Schema.String.pipe(Schema.check(Schema.isMaxLength(100))),
  mediaToken: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  kind: Schema.Literals(['image', 'video']),
  width: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(4096),
    ),
  ),
  height: Schema.Number.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(4096),
    ),
  ),
  sizeBytes: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  ),
});

// The page envelope: item rows stay `unknown` because one malformed row is
// dropped and the rest stay, like malformed sticker rows inside a pack. A
// non-string `nextPos` is ignored rather than failing the page.
const GifEnvelopeSchema = struct({
  items: Schema.mutable(Schema.Array(Schema.Unknown)),
  nextPos: Schema.optional(Schema.Unknown),
});

/** One GIF row the panel may show; malformed rows return null. */
export function parseGifItem(value: unknown, apiUrl: string): GifItem | null {
  const decoded = Schema.decodeUnknownExit(GifItemSchema)(value);
  if (!Exit.isSuccess(decoded)) {
    return null;
  }
  const item = decoded.value;
  return {
    id: item.id,
    title: item.title,
    url: gifMediaUrl(item.mediaToken, apiUrl),
    kind: item.kind,
    width: item.width,
    height: item.height,
    ...(item.sizeBytes === undefined ? {} : { sizeBytes: item.sizeBytes }),
  };
}

/** The same-origin proxy URL for one GIF result's media. */
export function gifMediaUrl(mediaToken: string, apiUrl: string): string {
  return `${apiOrigin(apiUrl)}/api/gifs/media/${encodeURIComponent(mediaToken)}`;
}

function apiOrigin(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return apiUrl.replace(/\/+$/, '');
  }
}

export interface GifPage {
  items: GifItem[];
  nextPos?: string | undefined;
}

/** True when the caller already aborted the request. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

export interface GifsApi {
  searchGifs(query: string, pos?: string, signal?: AbortSignal): Promise<GifPage>;
  trendingGifs(pos?: string, signal?: AbortSignal): Promise<GifPage>;
}

// The internal failures, one per case. They carry no field beyond what the old
// `GifsApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message. An abort is re-raised as the caller's
// `AbortError`, never mapped to an API error.
class GifsNetworkError extends Data.TaggedError('GifsNetworkError') {}
class GifsRequestError extends Data.TaggedError('GifsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class GifsUnauthorized extends Data.TaggedError('GifsUnauthorized') {}
class GifsInvalidResponse extends Data.TaggedError('GifsInvalidResponse') {}
class GifsAborted extends Data.TaggedError('GifsAborted') {}

const gifRequestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  endpoint: 'search' | 'trending',
  query: string | undefined,
  pos: string | undefined,
  getToken: TokenProvider,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): EffectType.fn.Return<
  GifPage,
  GifsUnauthorized | GifsAborted | GifsNetworkError | GifsRequestError | GifsInvalidResponse
> {
  const token = yield* Effect.promise(() => getToken());
  if (token === undefined) {
    return yield* new GifsUnauthorized();
  }
  if (isAborted(signal)) {
    return yield* new GifsAborted();
  }
  const params = new URLSearchParams();
  if (query !== undefined && query !== '') {
    params.set('q', query);
  }
  if (pos !== undefined && pos !== '') {
    params.set('pos', pos);
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  const response = yield* Effect.tryPromise({
    try: () =>
      fetchImpl(`${apiUrl}/api/gifs/${endpoint}${suffix}`, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        ...(signal === undefined ? {} : { signal }),
      }),
    catch: (error) =>
      error instanceof DOMException && error.name === 'AbortError'
        ? new GifsAborted()
        : new GifsNetworkError(),
  });
  if (isAborted(signal)) {
    return yield* new GifsAborted();
  }
  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );
  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new GifsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  const envelope = Schema.decodeUnknownExit(GifEnvelopeSchema)(body);
  if (!Exit.isSuccess(envelope)) {
    return yield* new GifsInvalidResponse();
  }
  const items: GifItem[] = [];
  for (const entry of envelope.value.items) {
    // One malformed row is dropped and the rest stay, like malformed
    // sticker rows inside a pack.
    const item = parseGifItem(entry, apiUrl);
    if (item !== null) {
      items.push(item);
    }
  }
  const nextPos = envelope.value.nextPos;
  return {
    items,
    ...(typeof nextPos === 'string' && nextPos !== '' ? { nextPos } : {}),
  };
});

/** The production `GifsApi`: bearer auth, `fetch`, build-time API URL. */
export function createGifsApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): GifsApi {
  return {
    searchGifs: (query, pos, signal) =>
      gifRequest(apiUrl, 'search', query, pos, getToken, fetchImpl, signal),
    trendingGifs: (pos, signal) =>
      gifRequest(apiUrl, 'trending', undefined, pos, getToken, fetchImpl, signal),
  };
}

function gifRequest(
  apiUrl: string,
  endpoint: 'search' | 'trending',
  query: string | undefined,
  pos: string | undefined,
  getToken: TokenProvider,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<GifPage> {
  return Effect.runPromise(
    gifRequestEffect(apiUrl, endpoint, query, pos, getToken, fetchImpl, signal).pipe(
      Effect.catchTags({
        GifsUnauthorized: () => Effect.fail(new GifsApiError(401, 'unauthorized', 'No session')),
        GifsAborted: () => Effect.die(new DOMException('Aborted', 'AbortError')),
        GifsNetworkError: () =>
          Effect.fail(new GifsApiError(0, 'network_error', 'Could not reach the server')),
        GifsRequestError: (error) =>
          Effect.fail(new GifsApiError(error.status, error.code, error.message)),
        GifsInvalidResponse: () =>
          Effect.fail(
            new GifsApiError(200, 'invalid_response', 'The server sent an unexpected response'),
          ),
      }),
    ),
  );
}
