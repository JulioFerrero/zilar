// Sticker pack routes (T-1046): list, create, patch, delete, discover, sticker
// upload/delete and the fake Telegram import. Bodies and mutations mirror web's
// mock (`apps/web/src/mock/api.ts:2326-2482`). Split out of `routes.ts` so no
// file crosses the 400-line cap.
import type { MockData } from '../../state';
import {
  errorResponse,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import { mockStickerFileUrl, mockStickerId, type MockSticker, type MockStickerPack } from './seed';

const MAX_PACK_STICKERS = 120;
const TITLE_MAX = 60;

export function handlePacks(data: MockData, request: MockHttpRequest): Response | undefined {
  const [, first, second, third] = request.segments;
  if (first === undefined) {
    if (request.method === 'GET') {
      const packs = data.stickerPanel
        .map((id) => data.stickerPacks.find((pack) => pack.id === id))
        .filter((pack): pack is MockStickerPack => pack !== undefined);
      return jsonResponse({ packs });
    }
    if (request.method === 'POST') {
      return createPack(data, request);
    }
    return undefined;
  }
  if (first === 'discover') {
    if (request.method !== 'GET') {
      return undefined;
    }
    const query = (request.query.get('q') ?? '').trim().toLowerCase();
    const packs = data.stickerPacks.filter(
      (pack) =>
        pack.visibility === 'server' && (query === '' || pack.title.toLowerCase().includes(query)),
    );
    return jsonResponse({ packs, next: null });
  }
  if (first === 'import' && second === 'telegram') {
    if (request.method !== 'POST') {
      return undefined;
    }
    return importTelegram(data, request);
  }
  const packId = decodeURIComponent(first);
  if (second === undefined && request.method === 'PATCH') {
    return patchPack(data, request, packId);
  }
  if (second === undefined && request.method === 'DELETE') {
    return deletePack(data, packId);
  }
  if (second === 'stickers' && third === undefined && request.method === 'POST') {
    return uploadSticker(data, request, packId);
  }
  if (second === 'stickers' && third !== undefined && request.method === 'DELETE') {
    return deleteSticker(data, packId, decodeURIComponent(third));
  }
  return undefined;
}

function createPack(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title === '' || title.length > TITLE_MAX) {
    return errorResponse('invalid_request', 'title must be 1-60 characters', 400);
  }
  const visibility = body.visibility === undefined ? 'private' : body.visibility;
  if (visibility !== 'private' && visibility !== 'server') {
    return errorResponse('invalid_request', 'visibility must be private or server', 400);
  }
  const now = new Date().toISOString();
  const pack: MockStickerPack = {
    id: mockStickerId(nextSequence(data)),
    ownerId: data.me.id,
    title,
    visibility,
    stickers: [],
    createdAt: now,
    updatedAt: now,
  };
  data.stickerPacks = [...data.stickerPacks, pack];
  data.stickerPanel = [...data.stickerPanel, pack.id];
  return jsonResponse(pack, 201);
}

function patchPack(data: MockData, request: MockHttpRequest, packId: string): Response {
  const pack = findPack(data, packId);
  if (pack === undefined) {
    return notFound('Sticker pack not found');
  }
  const body = readJsonBody(request.init);
  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title === '' || title.length > TITLE_MAX) {
      return errorResponse('invalid_request', 'title must be 1-60 characters', 400);
    }
    pack.title = title;
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== 'private' && body.visibility !== 'server') {
      return errorResponse('invalid_request', 'visibility must be private or server', 400);
    }
    pack.visibility = body.visibility;
  }
  if (body.order !== undefined) {
    if (!Array.isArray(body.order)) {
      return errorResponse('invalid_request', 'order must list every sticker exactly once', 400);
    }
    const byId = new Map(pack.stickers.map((sticker) => [sticker.id, sticker]));
    const order = body.order.filter((id): id is string => typeof id === 'string');
    if (order.length !== pack.stickers.length || !order.every((id) => byId.has(id))) {
      return errorResponse('invalid_request', 'order must list every sticker exactly once', 400);
    }
    pack.stickers = order.map((id) => byId.get(id) as MockSticker);
  }
  touchPack(pack);
  return jsonResponse(pack);
}

function deletePack(data: MockData, packId: string): Response {
  const pack = findPack(data, packId);
  if (pack === undefined) {
    return notFound('Sticker pack not found');
  }
  const stickerIds = new Set(pack.stickers.map((sticker) => sticker.id));
  data.stickerPacks = data.stickerPacks.filter((row) => row.id !== packId);
  data.stickerPanel = data.stickerPanel.filter((id) => id !== packId);
  data.stickerFavorites = data.stickerFavorites.filter((id) => !stickerIds.has(id));
  return jsonResponse({
    warning:
      'The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker.',
  });
}

function uploadSticker(data: MockData, request: MockHttpRequest, packId: string): Response {
  const pack = findPack(data, packId);
  if (pack === undefined) {
    return notFound('Sticker pack not found');
  }
  if (pack.stickers.length >= MAX_PACK_STICKERS) {
    return errorResponse('pack_full', 'A pack holds at most 120 stickers', 400);
  }
  const emojiHeader = headerOf(request.init, 'x-emoji');
  let emojiValue = emojiHeader ?? '';
  if (emojiValue.includes('%')) {
    emojiValue = decodePercent(emojiValue.slice(0, 64));
  }
  const emoji = emojiValue !== '' ? emojiValue.slice(0, 8) : null;
  const contentType = headerOf(request.init, 'content-type') ?? '';
  const mime = contentType === 'image/png' ? 'image/png' : 'image/webp';
  const body: unknown = request.init.body;
  const bytes =
    typeof body === 'object' && body !== null && typeof (body as Blob).size === 'number'
      ? (body as Blob).size
      : 1024;
  const sticker: MockSticker = {
    id: mockStickerId(nextSequence(data)),
    packId,
    emoji,
    mime,
    width: 200,
    height: 200,
    bytes,
    url: '',
  };
  sticker.url = mockStickerFileUrl(sticker.id);
  pack.stickers = [...pack.stickers, sticker];
  touchPack(pack);
  return jsonResponse(sticker, 201);
}

function deleteSticker(data: MockData, packId: string, stickerId: string): Response {
  const pack = findPack(data, packId);
  const sticker = pack?.stickers.find((row) => row.id === stickerId);
  if (pack === undefined || sticker === undefined) {
    return notFound('Sticker not found');
  }
  pack.stickers = pack.stickers.filter((row) => row.id !== stickerId);
  data.stickerFavorites = data.stickerFavorites.filter((id) => id !== stickerId);
  touchPack(pack);
  return jsonResponse({ ok: true });
}

function importTelegram(data: MockData, request: MockHttpRequest): Response {
  const body = readJsonBody(request.init);
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (input === '') {
    return errorResponse('invalid_request', 'Give a sticker pack link or name', 400);
  }
  if (input === '__mock_unavailable') {
    return errorResponse('import_unavailable', 'Telegram import is not configured', 501);
  }
  if (input === '__mock_missing') {
    return notFound('Sticker pack not found');
  }
  const name = /([A-Za-z0-9_]{1,64})$/.exec(input)?.[1] ?? 'Imported';
  const importedFrom = `telegram:${name}`;
  const now = new Date().toISOString();
  let pack = data.stickerPacks.find((row) => row.importedFrom === importedFrom);
  if (pack === undefined) {
    pack = {
      id: mockStickerId(nextSequence(data)),
      ownerId: data.me.id,
      title: `${name} (Telegram)`.slice(0, TITLE_MAX),
      visibility: 'private',
      importedFrom,
      stickers: [],
      createdAt: now,
      updatedAt: now,
    };
    data.stickerPacks = [...data.stickerPacks, pack];
    data.stickerPanel = [...data.stickerPanel, pack.id];
  }
  const demoArt = data.stickerPacks[0]?.stickers ?? [];
  let imported = 0;
  for (const art of demoArt.slice(0, 6)) {
    if (pack.stickers.length >= MAX_PACK_STICKERS) {
      break;
    }
    if (pack.stickers.some((row) => row.sourceId === art.id)) {
      continue;
    }
    const sticker: MockSticker = {
      id: mockStickerId(nextSequence(data)),
      packId: pack.id,
      emoji: art.emoji,
      mime: 'image/png',
      width: 200,
      height: 200,
      bytes: 1024,
      url: '',
      sourceId: art.id,
    };
    sticker.url = mockStickerFileUrl(sticker.id);
    pack.stickers = [...pack.stickers, sticker];
    imported += 1;
  }
  touchPack(pack);
  return jsonResponse({
    pack,
    imported,
    skippedAnimated: 1,
    skippedInvalid: 0,
    ...(input === '__mock_partial' ? { partial: true } : {}),
  });
}

function findPack(data: MockData, packId: string): MockStickerPack | undefined {
  return data.stickerPacks.find((pack) => pack.id === packId);
}

/**
 * Percent-decode a header value without throwing on a malformed escape, like the
 * real server's lenient decode (`URLSearchParams` keeps a bad `%` as-is).
 */
function decodePercent(value: string): string {
  return new URLSearchParams(`v=${value}`).get('v') ?? '';
}

function nextSequence(data: MockData): number {
  data.nextStickerSequence += 1;
  return data.nextStickerSequence;
}

function touchPack(pack: MockStickerPack): void {
  pack.updatedAt = new Date().toISOString();
}

function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = init.headers;
  if (headers === undefined) {
    return undefined;
  }
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string>;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === wanted && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}
