import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';
import { getSessionToken } from './session-token';
import type { StickerItem, StickerPack } from './stickers';

/**
 * The sticker panel client (T-0143), the mobile twin of the web sticker list
 * in `apps/web/src/lib/api.ts`: `GET /api/sticker-packs` (my panel, ordered,
 * with stickers). T-0187 adds the panel management calls (discover, add,
 * remove, reorder) and the favorites calls, mirroring the web client
 * function names. Creating packs stays web-only.
 *
 * The boundary is validated with Effect Schema (T-0550, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge
 * with `Effect.runPromise`. Malformed rows are dropped, never rendered.
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

const NonEmptyStringSchema = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const StickerUrlSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
);
const StickerDimensionSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(512)),
);
const StickerMimeSchema = Schema.Literals(['image/webp', 'image/png']);

// The row without its pack id: the pack id rides on the envelope (or the
// favorites row) and is attached by the parser, like the old hand validator.
const StickerItemRowSchema = struct({
  id: NonEmptyStringSchema,
  url: StickerUrlSchema,
  width: StickerDimensionSchema,
  height: StickerDimensionSchema,
  mime: StickerMimeSchema,
  emoji: Schema.optional(Schema.Unknown),
});

// The pack envelope: sticker rows decode as unknowns so one malformed row is
// dropped and the rest stay; the editor metadata rides along when present.
const StickerPackEnvelopeSchema = struct({
  id: NonEmptyStringSchema,
  title: Schema.String,
  stickers: Schema.mutable(Schema.Array(Schema.Unknown)),
  ownerId: Schema.optional(Schema.Unknown),
  visibility: Schema.optional(Schema.Unknown),
  importedFrom: Schema.optional(Schema.Unknown),
});

/** One sticker row the panel may show; malformed rows return null. */
export function parseStickerItem(value: unknown, packId: string): StickerItem | null {
  const decoded = Schema.decodeUnknownExit(StickerItemRowSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const emoji = decoded.value.emoji;
  if (emoji !== null && emoji !== undefined && typeof emoji !== 'string') {
    return null;
  }
  return {
    id: decoded.value.id,
    packId,
    url: decoded.value.url,
    emoji: typeof emoji === 'string' && emoji !== '' ? emoji.slice(0, 8) : null,
    width: decoded.value.width,
    height: decoded.value.height,
    mime: decoded.value.mime,
  };
}

/** One pack row the panel may show; malformed rows return null. */
export function parseStickerPack(value: unknown): StickerPack | null {
  const decoded = Schema.decodeUnknownExit(StickerPackEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const id = decoded.value.id;
  const items: StickerItem[] = [];
  for (const entry of decoded.value.stickers) {
    const item = parseStickerItem(entry, id);
    if (item !== null) {
      items.push(item);
    }
  }
  // T-0191: the editor metadata rides along when present; wrong types are
  // ignored and the pack still parses (the panel keeps working unchanged).
  const ownerId = decoded.value.ownerId;
  const visibility = decoded.value.visibility;
  const importedFrom = decoded.value.importedFrom;
  return {
    id,
    title: decoded.value.title,
    ...(typeof ownerId === 'string' && ownerId !== '' ? { ownerId } : {}),
    ...(visibility === 'private' || visibility === 'server' ? { visibility } : {}),
    ...(typeof importedFrom === 'string' && importedFrom !== '' ? { importedFrom } : {}),
    stickers: items,
  };
}

/** The Telegram import outcome (web `TelegramImportResult`): `partial`
 * is false when the server omits it. */
export interface TelegramImportResult {
  pack: StickerPack;
  imported: number;
  skippedAnimated: number;
  skippedInvalid: number;
  partial: boolean;
}

const NonNegativeIntSchema = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
);

const TelegramImportEnvelopeSchema = struct({
  pack: Schema.Unknown,
  imported: NonNegativeIntSchema,
  skippedAnimated: NonNegativeIntSchema,
  skippedInvalid: NonNegativeIntSchema,
  partial: Schema.optional(Schema.Boolean),
});

/** Parses the import result; malformed bodies return null. */
export function parseTelegramImportResult(value: unknown): TelegramImportResult | null {
  const decoded = Schema.decodeUnknownExit(TelegramImportEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  const pack = parseStickerPack(decoded.value.pack);
  if (pack === null) return null;
  return {
    pack,
    imported: decoded.value.imported,
    skippedAnimated: decoded.value.skippedAnimated,
    skippedInvalid: decoded.value.skippedInvalid,
    partial: decoded.value.partial === true,
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
  /** Imports a Telegram pack as a new private pack (web `importTelegramStickers`). */
  importTelegramStickers(input: string): Promise<TelegramImportResult>;
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

// The internal failures, one per case. They carry no field beyond what the old
// `StickersApiError` already surfaced; the `Promise` edge maps each back to
// that same error, status, code and message.
class StickersNetworkError extends Data.TaggedError('StickersNetworkError') {}
class StickersRequestError extends Data.TaggedError('StickersRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class StickersUnauthorized extends Data.TaggedError('StickersUnauthorized') {}
class StickersInvalidResponse extends Data.TaggedError('StickersInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, StickersNetworkError | StickersRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new StickersNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new StickersRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

const parseDeleteBody = (value: unknown): undefined | null => {
  const decoded = Schema.decodeUnknownExit(Schema.Unknown)(value);
  return Exit.isSuccess(decoded) ? undefined : null;
};

const PackListEnvelopeSchema = struct({
  packs: Schema.mutable(Schema.Array(Schema.Unknown)),
});

function parsePackList(body: unknown): StickerPack[] | null {
  const decoded = Schema.decodeUnknownExit(PackListEnvelopeSchema)(body);
  if (!Exit.isSuccess(decoded)) return null;
  const packs: StickerPack[] = [];
  for (const entry of decoded.value.packs) {
    // One malformed pack row is dropped and the rest stay, like
    // malformed sticker rows inside a pack.
    const pack = parseStickerPack(entry);
    if (pack !== null) {
      packs.push(pack);
    }
  }
  return packs;
}

const FavoriteListEnvelopeSchema = struct({
  favorites: Schema.mutable(Schema.Array(Schema.Unknown)),
});

const FavoriteRowSchema = struct({
  packId: Schema.String,
});

function parseFavoriteList(body: unknown): StickerItem[] | null {
  const decoded = Schema.decodeUnknownExit(FavoriteListEnvelopeSchema)(body);
  if (!Exit.isSuccess(decoded)) return null;
  const favorites: StickerItem[] = [];
  for (const entry of decoded.value.favorites) {
    // Favorites carry their pack id on the row (the server shapes them
    // like web's `stickerSchema`); a malformed row is dropped.
    const packDecoded = Schema.decodeUnknownExit(FavoriteRowSchema)(entry);
    const packId =
      Exit.isSuccess(packDecoded) && packDecoded.value.packId !== ''
        ? packDecoded.value.packId
        : '';
    const item = packId === '' ? null : parseStickerItem(entry, packId);
    if (item !== null) {
      favorites.push(item);
    }
  }
  return favorites;
}

const DiscoverEnvelopeSchema = struct({
  packs: Schema.mutable(Schema.Array(Schema.Unknown)),
  next: Schema.NullOr(Schema.String),
});

function parseDiscoverPage(body: unknown): { packs: StickerPack[]; next: string | null } | null {
  const decoded = Schema.decodeUnknownExit(DiscoverEnvelopeSchema)(body);
  if (!Exit.isSuccess(decoded)) return null;
  const packs = parsePackList(body);
  if (packs === null) return null;
  return { packs, next: decoded.value.next };
}

const WarningEnvelopeSchema = struct({
  warning: Schema.String,
});

function parseWarning(body: unknown): { warning: string } | null {
  const decoded = Schema.decodeUnknownExit(WarningEnvelopeSchema)(body);
  return Exit.isSuccess(decoded) ? { warning: decoded.value.warning } : null;
}

/** The production `StickersApi`: bearer auth, `fetch`, build-time API URL. */
export function createStickersApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
  binaryUpload: StickerBinaryUpload = { upload: defaultBinaryUpload },
): StickersApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    StickersUnauthorized | StickersNetworkError | StickersRequestError | StickersInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new StickersUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new StickersInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          StickersUnauthorized: () =>
            Effect.fail(new StickersApiError(401, 'unauthorized', 'No session')),
          StickersNetworkError: () =>
            Effect.fail(new StickersApiError(0, 'network_error', 'Could not reach the server')),
          StickersRequestError: (error) =>
            Effect.fail(new StickersApiError(error.status, error.code, error.message)),
          StickersInvalidResponse: () =>
            Effect.fail(
              new StickersApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  const uploadStickerFileEffect = Effect.fnUntraced(function* (
    packId: string,
    file: { uri: string; mimeType: 'image/webp' | 'image/png' },
    emoji: string | undefined,
  ): EffectType.fn.Return<
    StickerItem,
    StickersUnauthorized | StickersRequestError | StickersInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new StickersUnauthorized();
    }
    const headers: Record<string, string> = {
      'content-type': file.mimeType,
      authorization: `Bearer ${token}`,
    };
    if (emoji !== undefined && emoji !== '') {
      headers['x-emoji'] = encodeURIComponent(emoji);
    }
    // A rejected upload propagates like the old `await` did; only the
    // response decode changes.
    const result = yield* Effect.promise(() =>
      binaryUpload.upload(
        `${apiUrl}/api/sticker-packs/${encodeURIComponent(packId)}/stickers`,
        file.uri,
        headers,
      ),
    );
    if (result.status < 200 || result.status >= 300) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        parsed = null;
      }
      const error = errorFieldsOf(parsed);
      return yield* new StickersRequestError({
        status: result.status,
        code: error.code ?? 'request_failed',
        message: error.message ?? `Request failed (${result.status})`,
      });
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }
    const item = parseStickerItem(parsed, packId);
    if (item === null) {
      return yield* new StickersInvalidResponse();
    }
    return item;
  });

  const uploadStickerFile = (
    packId: string,
    file: { uri: string; mimeType: 'image/webp' | 'image/png' },
    emoji: string | undefined,
  ): Promise<StickerItem> =>
    Effect.runPromise(
      uploadStickerFileEffect(packId, file, emoji).pipe(
        Effect.catchTags({
          StickersUnauthorized: () =>
            Effect.fail(new StickersApiError(401, 'unauthorized', 'No session')),
          StickersRequestError: (error) =>
            Effect.fail(new StickersApiError(error.status, error.code, error.message)),
          StickersInvalidResponse: () =>
            Effect.fail(
              new StickersApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    async listStickerPacks() {
      const body = await withToken('/api/sticker-packs', { method: 'GET' }, parsePackList);
      return body as StickerPack[];
    },
    async discoverStickerPacks(query?: string) {
      const trimmed = query?.trim() ?? '';
      const params = new URLSearchParams();
      if (trimmed !== '') {
        params.set('q', trimmed);
      }
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      const body = await withToken(
        `/api/sticker-packs/discover${suffix}`,
        { method: 'GET' },
        parseDiscoverPage,
      );
      return body as { packs: StickerPack[]; next: string | null };
    },
    async addStickerPanelPack(packId: string) {
      await withToken(
        `/api/sticker-panel/${encodeURIComponent(packId)}`,
        { method: 'PUT' },
        parseDeleteBody,
      );
    },
    async removeStickerPanelPack(packId: string) {
      await withToken(
        `/api/sticker-panel/${encodeURIComponent(packId)}`,
        { method: 'DELETE' },
        parseDeleteBody,
      );
    },
    async reorderStickerPanelPacks(order: string[]) {
      await withToken(
        '/api/sticker-panel',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ order }),
        },
        parseDeleteBody,
      );
    },
    async listStickerFavorites() {
      const body = await withToken('/api/sticker-favorites', { method: 'GET' }, parseFavoriteList);
      return body as StickerItem[];
    },
    async removeStickerFavorite(stickerId: string) {
      const params = new URLSearchParams({ sticker_id: stickerId });
      await withToken(
        `/api/sticker-favorites?${params.toString()}`,
        { method: 'DELETE' },
        parseDeleteBody,
      );
    },
    async importTelegramStickers(input: string) {
      const body = await withToken(
        '/api/sticker-packs/import/telegram',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input }),
        },
        parseTelegramImportResult,
      );
      return body as TelegramImportResult;
    },
    async createStickerPack(input) {
      const body = await withToken(
        '/api/sticker-packs',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parseStickerPack,
      );
      return body as StickerPack;
    },
    async patchStickerPack(packId, input) {
      const body = await withToken(
        `/api/sticker-packs/${encodeURIComponent(packId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        parseStickerPack,
      );
      return body as StickerPack;
    },
    async deleteStickerPack(packId) {
      const body = await withToken(
        `/api/sticker-packs/${encodeURIComponent(packId)}`,
        { method: 'DELETE' },
        parseWarning,
      );
      return body as { warning: string };
    },
    async deletePackSticker(packId, stickerId) {
      await withToken(
        `/api/sticker-packs/${encodeURIComponent(packId)}/stickers/${encodeURIComponent(stickerId)}`,
        { method: 'DELETE' },
        parseDeleteBody,
      );
    },
    async uploadStickerFile(packId, file, emoji) {
      return uploadStickerFile(packId, file, emoji);
    },
  };
}
