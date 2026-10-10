// Sticker routes (T-1046): the dispatcher, the panel (reorder, add, remove),
// favorites (list, add, remove) and the sticker file GET. Pack routes live in
// `packs.ts`; together they mirror web's mock
// (`apps/web/src/mock/api.ts:2326-2482`).
import type { MockData } from '../../state';
import {
  errorResponse,
  jsonResponse,
  notFound,
  readJsonBody,
  type MockHttpRequest,
} from '../../http/shared';
import { handlePacks } from './packs';
import { stickerArt, type MockSticker } from './seed';

const MAX_PANEL_PACKS = 200;
const MAX_FAVORITES = 200;

export function handleStickers(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head === 'sticker-packs') {
    return handlePacks(data, request);
  }
  if (head === 'sticker-panel') {
    return handlePanel(data, request, first);
  }
  if (head === 'sticker-favorites') {
    return handleFavorites(data, request);
  }
  if (head === 'stickers' && second === 'file' && first !== undefined) {
    return handleStickerFile(request, first);
  }
  return undefined;
}

function handlePanel(
  data: MockData,
  request: MockHttpRequest,
  first: string | undefined,
): Response | undefined {
  if (first === undefined) {
    // The bare path is the atomic reorder; a trailing slash is no route.
    if (request.method !== 'PUT') {
      return undefined;
    }
    const rawPath = request.path.includes('?')
      ? request.path.slice(0, request.path.indexOf('?'))
      : request.path;
    if (rawPath.endsWith('/')) {
      return notFound('Sticker pack not found');
    }
    const body = readJsonBody(request.init);
    const order = Array.isArray(body.order)
      ? body.order.filter((id): id is string => typeof id === 'string')
      : undefined;
    if (
      order === undefined ||
      order.length !== data.stickerPanel.length ||
      !order.every((id) => data.stickerPanel.includes(id)) ||
      new Set(order).size !== order.length
    ) {
      return errorResponse('invalid_request', 'order must list every panel pack exactly once', 400);
    }
    data.stickerPanel = order;
    return jsonResponse({ ok: true });
  }
  const packId = decodeURIComponent(first);
  if (request.method === 'PUT') {
    if (
      data.stickerPacks.some((pack) => pack.id === packId) &&
      !data.stickerPanel.includes(packId)
    ) {
      if (data.stickerPanel.length >= MAX_PANEL_PACKS) {
        return errorResponse('panel_full', 'A panel holds at most 200 packs', 400);
      }
      data.stickerPanel = [...data.stickerPanel, packId];
    }
    return jsonResponse({ ok: true });
  }
  if (request.method === 'DELETE') {
    data.stickerPanel = data.stickerPanel.filter((id) => id !== packId);
    return jsonResponse({ ok: true });
  }
  return undefined;
}

function handleFavorites(data: MockData, request: MockHttpRequest): Response | undefined {
  if (request.method === 'GET') {
    return jsonResponse({ favorites: favoriteRows(data) });
  }
  if (request.method === 'PUT') {
    const body = readJsonBody(request.init);
    const stickerId = typeof body.sticker_id === 'string' ? body.sticker_id : '';
    const sticker = findSticker(data, stickerId);
    if (sticker === undefined) {
      return notFound('Sticker not found');
    }
    if (!data.stickerFavorites.includes(stickerId)) {
      if (data.stickerFavorites.length >= MAX_FAVORITES) {
        return errorResponse('favorites_full', 'A user has at most 200 favorites', 400);
      }
      data.stickerFavorites = [...data.stickerFavorites, stickerId];
    }
    return jsonResponse(sticker);
  }
  if (request.method === 'DELETE') {
    const stickerId = request.query.get('sticker_id') ?? '';
    data.stickerFavorites = data.stickerFavorites.filter((id) => id !== stickerId);
    return jsonResponse({ ok: true });
  }
  return undefined;
}

function handleStickerFile(request: MockHttpRequest, stickerId: string): Response | undefined {
  if (request.method !== 'GET') {
    return undefined;
  }
  const art = stickerArt(decodeURIComponent(stickerId));
  if (art === undefined) {
    return notFound('Sticker not found');
  }
  return new Response(art, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
}

function findSticker(data: MockData, stickerId: string): MockSticker | undefined {
  for (const pack of data.stickerPacks) {
    const sticker = pack.stickers.find((row) => row.id === stickerId);
    if (sticker !== undefined) {
      return sticker;
    }
  }
  return undefined;
}

function favoriteRows(data: MockData): MockSticker[] {
  const rows: MockSticker[] = [];
  for (const id of data.stickerFavorites) {
    const sticker = findSticker(data, id);
    if (sticker !== undefined) {
      rows.push(sticker);
    }
  }
  return rows;
}
