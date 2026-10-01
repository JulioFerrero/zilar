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
 * Mobile has no zod, so — like `stickers-api.ts` — the boundary is validated
 * with type guards. Malformed rows are dropped, never rendered. Queries are
 * never logged.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isGifKind(value: unknown): value is GifItem['kind'] {
  return value === 'image' || value === 'video';
}

/** One GIF row the panel may show; malformed rows return null. */
export function parseGifItem(value: unknown, apiUrl: string): GifItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = value['id'];
  const title = value['title'];
  const mediaToken = value['mediaToken'];
  const kind = value['kind'];
  const width = value['width'];
  const height = value['height'];
  const sizeBytes = value['sizeBytes'];
  if (
    !isString(id) ||
    id === '' ||
    id.length > 128 ||
    !isString(title) ||
    title.length > 100 ||
    !isString(mediaToken) ||
    mediaToken === '' ||
    mediaToken.length > 2048 ||
    !isGifKind(kind) ||
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 4096 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 4096 ||
    (sizeBytes !== undefined &&
      (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0))
  ) {
    return null;
  }
  return {
    id,
    title,
    url: gifMediaUrl(mediaToken, apiUrl),
    kind,
    width,
    height,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
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

async function gifRequest(
  apiUrl: string,
  endpoint: 'search' | 'trending',
  query: string | undefined,
  pos: string | undefined,
  getToken: TokenProvider,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<GifPage> {
  const token = await getToken();
  if (token === undefined) {
    throw new GifsApiError(401, 'unauthorized', 'No session');
  }
  if (isAborted(signal)) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const params = new URLSearchParams();
  if (query !== undefined && query !== '') {
    params.set('q', query);
  }
  if (pos !== undefined && pos !== '') {
    params.set('pos', pos);
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`;
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/api/gifs/${endpoint}${suffix}`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new GifsApiError(0, 'network_error', 'Could not reach the server');
  }
  if (isAborted(signal)) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new GifsApiError(response.status, code, message);
  }
  if (!isRecord(body) || !Array.isArray(body['items'])) {
    throw new GifsApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  const nextPos = body['nextPos'];
  const items: GifItem[] = [];
  for (const entry of body['items']) {
    // One malformed row is dropped and the rest stay, like malformed
    // sticker rows inside a pack.
    const item = parseGifItem(entry, apiUrl);
    if (item !== null) {
      items.push(item);
    }
  }
  return {
    items,
    ...(isString(nextPos) && nextPos !== '' ? { nextPos } : {}),
  };
}
