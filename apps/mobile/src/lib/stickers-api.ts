import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import type { StickerItem, StickerPack } from './stickers';

/**
 * The sticker panel client (T-0143), the mobile twin of the web sticker list
 * in `apps/web/src/lib/api.ts`: `GET /api/sticker-packs` (my panel, ordered,
 * with stickers). T-0187 adds the panel management calls (discover, add,
 * remove, reorder) and the favorites calls, mirroring the web client
 * function names. Creating packs stays web-only.
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
  // T-0191: the editor metadata rides along when present; wrong types are
  // ignored and the pack still parses (the panel keeps working unchanged).
  const ownerId = value['ownerId'];
  const visibility = value['visibility'];
  const importedFrom = value['importedFrom'];
  return {
    id,
    title,
    ...(typeof ownerId === 'string' && ownerId !== '' ? { ownerId } : {}),
    ...(visibility === 'private' || visibility === 'server' ? { visibility } : {}),
    ...(typeof importedFrom === 'string' && importedFrom !== '' ? { importedFrom } : {}),
    stickers: items,
  };
}

/** Reads the bearer session token from secure storage. */
export type TokenProvider = () => Promise<string | undefined>;

/**
 * The raw-bytes POST a sticker upload needs. Injected so tests use a fake
 * and never touch the native modules; production defaults to the
 * `expo-file-system` binary upload (the avatar uploader pattern).
 */
export interface StickerBinaryUpload {
  upload(
    url: string,
    uri: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }>;
}

async function defaultBinaryUpload(
  url: string,
  uri: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const { File, UploadType } = await import('expo-file-system');
  const source = new File(uri);
  try {
    const result = await source.upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
    });
    return { status: result.status, body: result.body };
  } catch {
    throw new StickersApiError(0, 'network_error', 'Could not reach the server');
  }
}

export interface StickersApi {
  listStickerPacks(): Promise<StickerPack[]>;
  /** Shared packs anyone on this server may add (web `discoverStickerPacks`). */
  discoverStickerPacks(query?: string): Promise<{ packs: StickerPack[]; next: string | null }>;
  addStickerPanelPack(packId: string): Promise<void>;
  removeStickerPanelPack(packId: string): Promise<void>;
  /** Reorders the whole panel; `order` is the complete id list, new order. */
  reorderStickerPanelPacks(order: string[]): Promise<void>;
  listStickerFavorites(): Promise<StickerItem[]>;
  removeStickerFavorite(stickerId: string): Promise<void>;
  /** Mints an empty pack (web `createStickerPack`). */
  createStickerPack(input: {
    title: string;
    visibility?: 'private' | 'server';
  }): Promise<StickerPack>;
  /** Renames, re-shares or reorders a pack (web `patchStickerPack`). */
  patchStickerPack(
    packId: string,
    input: { title?: string; visibility?: 'private' | 'server'; order?: string[] },
  ): Promise<StickerPack>;
  /**
   * Deletes a pack and its files (web `deleteStickerPack`): resolves the
   * server's keep-message warning, shown in the delete confirm copy.
   */
  deleteStickerPack(packId: string): Promise<{ warning: string }>;
  /** Deletes one sticker of a pack (web `deletePackSticker`). */
  deletePackSticker(packId: string, stickerId: string): Promise<void>;
  /**
   * Uploads one prepared sticker file: raw bytes (not multipart), the
   * `Content-Type` is the image type, and the emoji travels percent-encoded
   * in `x-emoji` (header values are latin1; a raw emoji throws in fetch).
   */
  uploadStickerFile(
    packId: string,
    file: { uri: string; mimeType: 'image/webp' | 'image/png' },
    emoji?: string,
  ): Promise<StickerItem>;
}

/** The production `StickersApi`: bearer auth, `fetch`, build-time API URL. */
export function createStickersApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
  binaryUpload: StickerBinaryUpload = { upload: defaultBinaryUpload },
): StickersApi {
  async function withToken(path: string, init: RequestInit): Promise<unknown> {
    const token = await getToken();
    if (token === undefined) {
      throw new StickersApiError(401, 'unauthorized', 'No session');
    }
    let response: Response;
    try {
      response = await fetchImpl(`${apiUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
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
    return body;
  }

  function parsePackList(body: unknown): StickerPack[] {
    if (!isRecord(body) || !Array.isArray(body['packs'])) {
      throw new StickersApiError(200, 'invalid_response', 'The server sent an unexpected response');
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
  }

  function parseFavoriteList(body: unknown): StickerItem[] {
    if (!isRecord(body) || !Array.isArray(body['favorites'])) {
      throw new StickersApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    const favorites: StickerItem[] = [];
    for (const entry of body['favorites']) {
      // Favorites carry their pack id on the row (the server shapes them
      // like web's `stickerSchema`); a malformed row is dropped.
      const packId = isRecord(entry) && isString(entry['packId']) ? entry['packId'] : '';
      const item = packId === '' ? null : parseStickerItem(entry, packId);
      if (item !== null) {
        favorites.push(item);
      }
    }
    return favorites;
  }

  return {
    async listStickerPacks() {
      return parsePackList(await withToken('/api/sticker-packs', { method: 'GET' }));
    },
    async discoverStickerPacks(query?: string) {
      const trimmed = query?.trim() ?? '';
      const params = new URLSearchParams();
      if (trimmed !== '') {
        params.set('q', trimmed);
      }
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      const body = await withToken(`/api/sticker-packs/discover${suffix}`, { method: 'GET' });
      if (
        !isRecord(body) ||
        !Array.isArray(body['packs']) ||
        (body['next'] !== null && !isString(body['next']))
      ) {
        throw new StickersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      const packs = parsePackList(body);
      return { packs, next: isString(body['next']) ? body['next'] : null };
    },
    async addStickerPanelPack(packId: string) {
      await withToken(`/api/sticker-panel/${encodeURIComponent(packId)}`, { method: 'PUT' });
    },
    async removeStickerPanelPack(packId: string) {
      await withToken(`/api/sticker-panel/${encodeURIComponent(packId)}`, { method: 'DELETE' });
    },
    async reorderStickerPanelPacks(order: string[]) {
      await withToken('/api/sticker-panel', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order }),
      });
    },
    async listStickerFavorites() {
      return parseFavoriteList(await withToken('/api/sticker-favorites', { method: 'GET' }));
    },
    async removeStickerFavorite(stickerId: string) {
      const params = new URLSearchParams({ sticker_id: stickerId });
      await withToken(`/api/sticker-favorites?${params.toString()}`, { method: 'DELETE' });
    },
    async createStickerPack(input) {
      const body = await withToken('/api/sticker-packs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const pack = parseStickerPack(body);
      if (pack === null) {
        throw new StickersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      return pack;
    },
    async patchStickerPack(packId, input) {
      const body = await withToken(`/api/sticker-packs/${encodeURIComponent(packId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const pack = parseStickerPack(body);
      if (pack === null) {
        throw new StickersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      return pack;
    },
    async deleteStickerPack(packId) {
      const body = await withToken(`/api/sticker-packs/${encodeURIComponent(packId)}`, {
        method: 'DELETE',
      });
      if (!isRecord(body) || !isString(body['warning'])) {
        throw new StickersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      return { warning: body['warning'] };
    },
    async deletePackSticker(packId, stickerId) {
      await withToken(
        `/api/sticker-packs/${encodeURIComponent(packId)}/stickers/${encodeURIComponent(stickerId)}`,
        { method: 'DELETE' },
      );
    },
    async uploadStickerFile(packId, file, emoji) {
      const token = await getToken();
      if (token === undefined) {
        throw new StickersApiError(401, 'unauthorized', 'No session');
      }
      const headers: Record<string, string> = {
        'content-type': file.mimeType,
        authorization: `Bearer ${token}`,
      };
      if (emoji !== undefined && emoji !== '') {
        headers['x-emoji'] = encodeURIComponent(emoji);
      }
      const result = await binaryUpload.upload(
        `${apiUrl}/api/sticker-packs/${encodeURIComponent(packId)}/stickers`,
        file.uri,
        headers,
      );
      if (result.status < 200 || result.status >= 300) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(result.body);
        } catch {
          parsed = null;
        }
        const error = isRecord(parsed) && isRecord(parsed['error']) ? parsed['error'] : null;
        const code = isString(error?.['code']) ? error['code'] : 'request_failed';
        const message = isString(error?.['message'])
          ? error['message']
          : `Request failed (${result.status})`;
        throw new StickersApiError(result.status, code, message);
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        parsed = null;
      }
      const item = parseStickerItem(parsed, packId);
      if (item === null) {
        throw new StickersApiError(
          200,
          'invalid_response',
          'The server sent an unexpected response',
        );
      }
      return item;
    },
  };
}
