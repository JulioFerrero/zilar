import { Effect, Exit, Schema } from 'effect';
import { GifResult, toApiError } from '@zilar/api-contract';
import { runApiAbortable } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';
import type { GifItem } from './gifs';

/**
 * Results carry opaque `mediaToken`s, never provider URLs, and previews load through the same-origin proxy. Queries are never logged.
 */

const MAX_DIMENSION = 4096;

function isDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
}

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

export function parseGifItem(value: unknown, apiUrl: string): GifItem | null {
  const decoded = Schema.decodeUnknownExit(GifResult)(value);
  return Exit.isSuccess(decoded) ? toGifItem(decoded.value, apiUrl) : null;
}

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

export type TokenProvider = () => Promise<string | undefined>;

export interface GifsApi {
  searchGifs(query: string, pos?: string, signal?: AbortSignal): Promise<GifPage>;
  trendingGifs(pos?: string, signal?: AbortSignal): Promise<GifPage>;
}

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
    // An abort is not an API failure: it surfaces as the `AbortError` a `fetch` abort would give.
    const page = await runApiAbortable(Effect.mapError(call, toApiError), signal);
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
