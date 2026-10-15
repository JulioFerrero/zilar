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
import { stickerArt, type MockSticker, type MockStickerPack } from './seed';
import { personHandle } from '../handles/check';

const MAX_PANEL_PACKS = 200;
const MAX_FAVORITES = 200;

export function handleStickers(data: MockData, request: MockHttpRequest): Response | undefined {
  const [head, first, second] = request.segments;
  if (head === 'sticker-packs') {
    return handlePackLink(data, request) ?? handlePacks(data, request);
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
    const pack = data.stickerPacks.find((row) => row.id === packId);
    // Like the server's `requireVisiblePack` (T-1495): a missing pack and an
    // imported pack owned by someone else are the same 404.
    if (pack === undefined || isHiddenImported(data, pack)) {
      return notFound('Sticker pack not found');
    }
    if (!data.stickerPanel.includes(packId)) {
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

// The pack link (T-1495): `GET /sticker-packs/:id` returns any pack by id,
// private or shared, with the owner's handle and whether it is in the viewer's
// panel. Imported packs stay personal to their importer; anyone else gets the
// same 404 as an unknown id. `handlePacks` keeps its own `/discover` route.
function handlePackLink(data: MockData, request: MockHttpRequest): Response | undefined {
  const [, first, second] = request.segments;
  if (request.method !== 'GET' || first === undefined || second !== undefined) {
    return undefined;
  }
  if (first === 'discover' || first === 'import') {
    return undefined;
  }
  const packId = decodeURIComponent(first);
  const pack = data.stickerPacks.find((row) => row.id === packId);
  if (pack === undefined || isHiddenImported(data, pack)) {
    return notFound('Sticker pack not found');
  }
  return jsonResponse({
    ...pack,
    ownerHandle: ownerHandle(data, pack.ownerId),
    inPanel: data.stickerPanel.includes(packId),
  });
}

/** An imported pack is visible only to the viewer who imported it. */
function isHiddenImported(data: MockData, pack: MockStickerPack): boolean {
  return pack.importedFrom !== undefined && pack.ownerId !== data.me.id;
}

/** The owner's handle, from the viewer row or a seed person, else null. */
function ownerHandle(data: MockData, ownerId: string): string | null {
  if (ownerId === data.me.id) {
    return data.me.handle;
  }
  const person = data.people.find((entry) => entry.id === ownerId);
  return person === undefined ? null : personHandle(data, person.id);
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
