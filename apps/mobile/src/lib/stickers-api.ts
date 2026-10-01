import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import type { StickerItem, StickerPack } from './stickers';

/**
 * The sticker panel client (T-0143), the mobile twin of the web sticker list
 * in `apps/web/src/lib/api.ts`: `GET /api/sticker-packs` (my panel, ordered,
 * with stickers). Creating packs stays web-only ("Create packs on the web
 * for now").
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated
 * with type guards. Malformed rows are dropped, never rendered.
 */

export class StickersApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StickersApiError';
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

function isStickerMime(value: unknown): value is StickerItem['mime'] {
  return value === 'image/webp' || value === 'image/png';
}

/** One sticker row the panel may show; malformed rows return null. */
export function parseStickerItem(value: unknown, packId: string): StickerItem | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const url = value['url'];
  const width = value['width'];
  const height = value['height'];
  const mime = value['mime'];
  const emoji = value['emoji'];
  if (
    !isString(id) ||
    id === '' ||
    !isString(url) ||
    url === '' ||
    url.length > 2048 ||
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 512 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 512 ||
    !isStickerMime(mime) ||
    (emoji !== null && emoji !== undefined && typeof emoji !== 'string')
  ) {
    return null;
  }
  return {
    id,
    packId,
    url,
    emoji: typeof emoji === 'string' && emoji !== '' ? emoji.slice(0, 8) : null,
    width,
    height,
    mime,
  };
}

/** One pack row the panel may show; malformed rows return null. */
export function parseStickerPack(value: unknown): StickerPack | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const title = value['title'];
  const stickers = value['stickers'];
  if (!isString(id) || id === '' || !isString(title) || !Array.isArray(stickers)) {
    return null;
  }
  const items: StickerItem[] = [];
  for (const entry of stickers) {
    const item = parseStickerItem(entry, id);
    if (item !== null) {
      items.push(item);
    }
  }
  return { id, title, stickers: items };
}

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

export interface StickersApi {
  listStickerPacks(): Promise<StickerPack[]>;
}

/** The production `StickersApi`: bearer auth, `fetch`, build-time API URL. */
export function createStickersApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): StickersApi {
  return {
    async listStickerPacks() {
      const token = await getToken();
      if (token === undefined) {
        throw new StickersApiError(401, 'unauthorized', 'No session');
      }
      let response: Response;
      try {
        response = await fetchImpl(`${apiUrl}/api/sticker-packs`, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        });
      } catch {
        throw new StickersApiError(0, 'network_error', 'Could not reach the server');
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
        const code = isString(error?.['code']) ? error['code'] : 'request_failed';
        const message = isString(error?.['message'])
          ? error['message']
          : `Request failed (${response.status})`;
        throw new StickersApiError(response.status, code, message);
      }
      if (!isRecord(body) || !Array.isArray(body['packs'])) {
        throw new StickersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      const packs: StickerPack[] = [];
      for (const entry of body['packs']) {
        // One malformed pack row is dropped and the rest stay, like
        // malformed sticker rows inside a pack.
        const pack = parseStickerPack(entry);
        if (pack !== null) {
          packs.push(pack);
        }
      }
      return packs;
    },
  };
}
