import { describe, expect, it, vi } from 'vitest';

import {
  createStickersApi,
  parseStickerItem,
  parseStickerPack,
  type StickersApi,
} from './stickers-api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ITEM = {
  id: '223e4567-e89b-12d3-a456-426614174001',
  emoji: '🐱',
  mime: 'image/png',
  width: 200,
  height: 200,
  bytes: 1024,
  url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
};

const PACK = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: 'u-me',
  title: 'Cats',
  visibility: 'server',
  stickers: [ITEM],
  createdAt: '2026-09-30T11:00:00Z',
  updatedAt: '2026-09-30T11:00:00Z',
};

describe('parseStickerPack', () => {
  it('parses a valid pack and drops malformed sticker rows', () => {
    const pack = parseStickerPack({ ...PACK, stickers: [ITEM, { id: 7 }] });
    expect(pack).toEqual({
      id: PACK.id,
      title: 'Cats',
      stickers: [
        {
          id: ITEM.id,
          packId: PACK.id,
          url: ITEM.url,
          emoji: '🐱',
          width: 200,
          height: 200,
          mime: 'image/png',
        },
      ],
    });
  });

  it('drops malformed packs and oversized rows', () => {
    expect(parseStickerPack(null)).toBeNull();
    expect(parseStickerPack({ ...PACK, id: '' })).toBeNull();
    expect(parseStickerPack({ ...PACK, stickers: 'nope' })).toBeNull();
    expect(parseStickerItem({ ...ITEM, width: 600 }, PACK.id)).toBeNull();
    expect(parseStickerItem({ ...ITEM, mime: 'image/gif' }, PACK.id)).toBeNull();
    expect(parseStickerItem({ ...ITEM, url: 'https://evil.test/x.webp' }, PACK.id)).not.toBeNull();
  });

  it('normalizes a null or empty emoji', () => {
    expect(parseStickerItem({ ...ITEM, emoji: null }, PACK.id)?.emoji).toBeNull();
    expect(parseStickerItem({ ...ITEM, emoji: '' }, PACK.id)?.emoji).toBeNull();
  });
});

describe('stickers api client', () => {
  function api(fetchImpl: unknown): StickersApi {
    return createStickersApi(async () => 'tok', fetchImpl as typeof fetch, 'http://127.0.0.1:3188');
  }

  it('lists the panel packs with the bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ packs: [PACK] }));
    const packs = await api(fetchImpl).listStickerPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.stickers).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/sticker-packs');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
  });

  it('drops one malformed pack and keeps the rest', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ packs: [{ id: 7 }, PACK] }));
    const packs = await api(fetchImpl).listStickerPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0]?.id).toBe(PACK.id);
  });

  it('rejects a panel body that is not a packs list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ packs: 'nope' }));
    await expect(api(fetchImpl).listStickerPacks()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('maps a server error to its code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'no' } }, 401),
    );
    await expect(api(fetchImpl).listStickerPacks()).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('throws unauthorized without a session and network_error offline', async () => {
    const noSession = createStickersApi(
      async () => undefined,
      (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(noSession.listStickerPacks()).rejects.toMatchObject({ status: 401 });
    const offline = createStickersApi(
      async () => 'tok',
      (async () => {
        throw new Error('down');
      }) as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(offline.listStickerPacks()).rejects.toMatchObject({ code: 'network_error' });
  });
});
