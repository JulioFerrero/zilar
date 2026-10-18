import { Effect } from 'effect';
import { toApiError, type GifResult, type ZilarClient } from '@zilar/api-contract';
import { makeGifsApi, runApiAbortable, type GifPage as SharedGifPage } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';
import type { GifItem } from './gifs';

/**
 * Results carry opaque `mediaToken`s, never provider URLs, and previews load through the same-origin proxy. Queries are never logged.
 */

function toGifItem(row: GifResult, apiUrl: string): GifItem {
  const sizeBytes = row.sizeBytes;
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

export type GifPage = SharedGifPage<GifItem>;

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
  // An abort is not an API failure: it surfaces as the `AbortError` a `fetch` abort would give.
  function call<A, E>(
    request: (client: ZilarClient) => Effect.Effect<A, E>,
    signal?: AbortSignal,
  ): Promise<A> {
    return runApiAbortable(Effect.mapError(request(client), toApiError), signal);
  }
  return makeGifsApi<GifItem>(call, (row) => toGifItem(row, apiUrl));
}
