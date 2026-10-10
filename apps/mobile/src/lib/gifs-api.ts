import { Effect, Exit, Schema } from 'effect';
import { ApiError, GifResult, toApiError } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';
import type { GifItem } from './gifs';

/**
 * The GIF search client (T-0148), the mobile twin of the web GIF calls in
 * `apps/web/src/lib/api.ts`: `GET /api/gifs/search?q=&pos=`,
 * `GET /api/gifs/trending?pos=`. Results carry opaque `mediaToken`s, never
 * provider URLs; previews and the send path load through the same-origin
 * proxy (`/api/gifs/media/:token`).
 *
 * A Promise port over the client derived from the shared contract
 * (`@zilar/api-contract`, `gifs.ts`, T-0910). The contract's page schema
 * drops a malformed row and keeps the rest (`lenientArray`); the bounds a row
 * must meet to be shown are checked here. Queries are never logged.
 */

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const GifsApiError = ApiError;
export type GifsApiError = ApiError;

const MAX_DIMENSION = 4096;

function isDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
}

/** One contract row as the panel shows it, or null when it is out of bounds. */
function toGifItem(row: GifResult, apiUrl: string): GifItem | null {
  const sizeBytes = row.sizeBytes;
  if (
    row.id.length < 1 ||
    row.id.length > 128 ||
    row.title.length > 100 ||
    row.mediaToken.length < 1 ||
    row.mediaToken.length > 2048 ||
    !isDimension(row.width) ||
    !isDimension(row.height) ||
    (sizeBytes !== undefined && (!Number.isInteger(sizeBytes) || sizeBytes < 0))
  ) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    url: gifMediaUrl(row.mediaToken, apiUrl),
    kind: row.kind,
    width: row.width,
    height: row.height,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  };
}

/** One GIF row the panel may show; malformed rows return null. */
export function parseGifItem(value: unknown, apiUrl: string): GifItem | null {
  const decoded = Schema.decodeUnknownExit(GifResult)(value);
  return Exit.isSuccess(decoded) ? toGifItem(decoded.value, apiUrl) : null;
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

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

export interface GifsApi {
  searchGifs(query: string, pos?: string, signal?: AbortSignal): Promise<GifPage>;
  trendingGifs(pos?: string, signal?: AbortSignal): Promise<GifPage>;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/** The production `GifsApi`: bearer auth, `fetch`, build-time API URL. */
export function createGifsApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): GifsApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const pageOf = async (
    call: Effect.Effect<
      { readonly items: ReadonlyArray<GifResult>; readonly nextPos?: string | undefined },
      unknown
    >,
    signal: AbortSignal | undefined,
  ): Promise<GifPage> => {
    // A function, not a direct read, so TypeScript does not narrow `aborted`
    // to `false` after the first check: the signal can still fire mid-request.
    const isAborted = () => signal?.aborted === true;
    if (isAborted()) {
      throw abortError();
    }
    let page;
    try {
      // An abort is not an API failure: it interrupts the request and
      // surfaces as the `AbortError` a `fetch` abort would give.
      page = await Effect.runPromise(
        Effect.mapError(call, toApiError),
        signal === undefined ? undefined : { signal },
      );
    } catch (error) {
      throw isAborted() ? abortError() : error;
    }
    if (isAborted()) {
      throw abortError();
    }
    const items: GifItem[] = [];
    for (const row of page.items) {
      const item = toGifItem(row, apiUrl);
      if (item !== null) {
        items.push(item);
      }
    }
    const nextPos = page.nextPos;
    return { items, ...(nextPos === undefined || nextPos === '' ? {} : { nextPos }) };
  };
  const posQuery = (pos: string | undefined) => (pos === undefined || pos === '' ? {} : { pos });
  return {
    searchGifs: (query, pos, signal) =>
      pageOf(
        client.gifs.search({ query: { ...(query === '' ? {} : { q: query }), ...posQuery(pos) } }),
        signal,
      ),
    trendingGifs: (pos, signal) => pageOf(client.gifs.trending({ query: posQuery(pos) }), signal),
  };
}
