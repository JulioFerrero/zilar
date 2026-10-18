import { Exit, Schema } from 'effect';
import {
  ApiError,
  runApi,
  Sticker as ContractSticker,
  StickerPack as ContractStickerPack,
  type StickerPackDetail as ContractStickerPackDetail,
  type TelegramImportResult as ContractTelegramImportResult,
} from '@zilar/api-contract';

import { API_URL } from './auth';
import { errorFieldsOf } from './api-error-body';
import { createApiClient } from './effect/api-client';
import { getSessionToken } from './session-token';
import type { StickerItem, StickerPack, StickerPackDetail } from './stickers';

/**
 * The list schemas drop a malformed pack or sticker row; only the raw byte upload stays outside the derived client.
 */

export const StickersApiError = ApiError;
export type StickersApiError = ApiError;

const MAX_STICKER_DIMENSION = 512;

function isStickerDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_STICKER_DIMENSION;
}

function toStickerItem(row: ContractSticker): StickerItem | null {
  if (
    row.id === '' ||
    row.url === '' ||
    row.url.length > 2048 ||
    !isStickerDimension(row.width) ||
    !isStickerDimension(row.height)
  ) {
    return null;
  }
  return {
    id: row.id,
    packId: row.packId,
    url: row.url,
    emoji: row.emoji === null || row.emoji === '' ? null : row.emoji.slice(0, 8),
    width: row.width,
    height: row.height,
    mime: row.mime,
  };
}

/**
 * The handle stays absent when the server sends none, and the rows then show only the count.
 */
export type PanelPack = StickerPack & { ownerHandle?: string | null };

function toStickerPack(
  row: ContractStickerPack & { ownerHandle?: string | null },
): PanelPack | null {
  if (row.id === '') {
    return null;
  }
  const ownerHandle = row.ownerHandle;
  return {
    id: row.id,
    title: row.title,
    ...(row.ownerId === '' ? {} : { ownerId: row.ownerId }),
    visibility: row.visibility,
    ...(row.importedFrom === undefined || row.importedFrom === ''
      ? {}
      : { importedFrom: row.importedFrom }),
    ...(ownerHandle === undefined || ownerHandle === null || ownerHandle === ''
      ? {}
      : { ownerHandle }),
    stickers: row.stickers.flatMap((sticker) => toStickerItem(sticker) ?? []),
  };
}

function toStickerPackDetail(row: ContractStickerPackDetail): StickerPackDetail | null {
  const pack = toStickerPack(row);
  if (pack === null) {
    return null;
  }
  return { ...pack, ownerHandle: row.ownerHandle, inPanel: row.inPanel };
}

export function parseStickerItem(value: unknown): StickerItem | null {
  const decoded = Schema.decodeUnknownExit(ContractSticker)(value);
  return Exit.isSuccess(decoded) ? toStickerItem(decoded.value) : null;
}

export function parseStickerPack(value: unknown): StickerPack | null {
  const decoded = Schema.decodeUnknownExit(ContractStickerPack)(value);
  return Exit.isSuccess(decoded) ? toStickerPack(decoded.value) : null;
}

/** `partial` is false when the server omits it. */
export interface TelegramImportResult {
  pack: StickerPack;
  imported: number;
  skippedAnimated: number;
  skippedInvalid: number;
  partial: boolean;
}

const INVALID_RESPONSE = 'The server sent an unexpected response';

function packOf(row: ContractStickerPack): StickerPack {
  const pack = toStickerPack(row);
  if (pack === null) {
    throw new ApiError(200, 'invalid_response', INVALID_RESPONSE);
  }
  return pack;
}

function toImportResult(body: ContractTelegramImportResult): TelegramImportResult {
  return {
    pack: packOf(body.pack),
    imported: body.imported,
    skippedAnimated: body.skippedAnimated,
    skippedInvalid: body.skippedInvalid,
    partial: body.partial === true,
  };
}

export type TokenProvider = () => Promise<string | undefined>;

/**
 * Injected so tests never touch the native modules; production uses an `expo-file-system` binary upload.
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
    throw new ApiError(0, 'network_error', 'Could not reach the server');
  }
}

export interface StickersApi {
  listStickerPacks(): Promise<StickerPack[]>;
  getStickerPack(packId: string): Promise<StickerPackDetail>;
  discoverStickerPacks(query?: string): Promise<{ packs: PanelPack[]; next: string | null }>;
  addStickerPanelPack(packId: string): Promise<void>;
  removeStickerPanelPack(packId: string): Promise<void>;
  reorderStickerPanelPacks(order: string[]): Promise<void>;
  listStickerFavorites(): Promise<StickerItem[]>;
  removeStickerFavorite(stickerId: string): Promise<void>;
  importTelegramStickers(input: string): Promise<TelegramImportResult>;
  createStickerPack(input: {
    title: string;
    visibility?: 'private' | 'server';
  }): Promise<StickerPack>;
  patchStickerPack(
    packId: string,
    input: { title?: string; visibility?: 'private' | 'server'; order?: string[] },
  ): Promise<StickerPack>;
  /**
   * Resolves the server's keep-message warning, shown in the delete confirm.
   */
  deleteStickerPack(packId: string): Promise<{ warning: string }>;
  deletePackSticker(packId: string, stickerId: string): Promise<void>;
  /**
   * Raw bytes, not multipart; the emoji travels percent-encoded in `x-emoji` because header values are latin1 and a raw emoji throws in fetch.
   */
  uploadStickerFile(
    packId: string,
    file: { uri: string; mimeType: string },
    emoji?: string,
  ): Promise<StickerItem>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function createStickersApi(
  getToken: TokenProvider = getSessionToken,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
  binaryUpload: StickerBinaryUpload = { upload: defaultBinaryUpload },
): StickersApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });

  const uploadStickerFile: StickersApi['uploadStickerFile'] = async (packId, file, emoji) => {
    const token = await getToken();
    if (token === undefined) {
      throw new ApiError(401, 'unauthorized', 'No session');
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
    const body = parseJson(result.body);
    if (result.status < 200 || result.status >= 300) {
      const error = errorFieldsOf(body);
      throw new ApiError(
        result.status,
        error.code ?? 'request_failed',
        error.message ?? `Request failed (${result.status})`,
      );
    }
    const item = parseStickerItem(body);
    if (item === null) {
      throw new ApiError(200, 'invalid_response', INVALID_RESPONSE);
    }
    return item;
  };

  return {
    listStickerPacks: () =>
      runApi(client.stickers.listPacks()).then((body) =>
        body.packs.flatMap((p) => toStickerPack(p) ?? []),
      ),
    getStickerPack: (packId) =>
      runApi(client.stickers.getPack({ params: { id: packId } })).then((row) => {
        const pack = toStickerPackDetail(row);
        if (pack === null) {
          throw new ApiError(200, 'invalid_response', INVALID_RESPONSE);
        }
        return pack;
      }),
    discoverStickerPacks: (query) => {
      const trimmed = query?.trim() ?? '';
      return runApi(client.stickers.discover({ query: trimmed === '' ? {} : { q: trimmed } })).then(
        (body) => ({
          packs: body.packs.flatMap((p) => toStickerPack(p) ?? []),
          next: body.next,
        }),
      );
    },
    addStickerPanelPack: async (packId) => {
      await runApi(client.stickers.addPanelPack({ params: { packId } }));
    },
    removeStickerPanelPack: async (packId) => {
      await runApi(client.stickers.removePanelPack({ params: { packId } }));
    },
    reorderStickerPanelPacks: async (order) => {
      await runApi(client.stickers.reorderPanel({ payload: { order } }));
    },
    listStickerFavorites: () =>
      runApi(client.stickers.listFavorites()).then((body) =>
        body.favorites.flatMap((s) => toStickerItem(s) ?? []),
      ),
    removeStickerFavorite: async (stickerId) => {
      await runApi(client.stickers.removeFavorite({ query: { sticker_id: stickerId } }));
    },
    importTelegramStickers: (input) =>
      runApi(client.stickers.importTelegram({ payload: { input } })).then(toImportResult),
    createStickerPack: (input) =>
      runApi(client.stickers.createPack({ payload: input })).then(packOf),
    patchStickerPack: (packId, input) =>
      runApi(client.stickers.patchPack({ params: { id: packId }, payload: input })).then(packOf),
    deleteStickerPack: (packId) =>
      runApi(client.stickers.deletePack({ params: { id: packId } })).then((body) => ({
        warning: body.warning,
      })),
    deletePackSticker: async (packId, stickerId) => {
      await runApi(client.stickers.deleteSticker({ params: { id: packId, stickerId } }));
    },
    uploadStickerFile,
  };
}
