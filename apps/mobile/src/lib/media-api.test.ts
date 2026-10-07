import { describe, expect, it, vi } from 'vitest';

import { createMediaApi, parseMediaItem, type MediaItem } from './media-api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ROW: MediaItem = {
  messageId: 'ana-11',
  chat: 'ana@zilar.test',
  at: '2026-09-30T11:00:00Z',
  senderName: 'Ana',
  kind: 'image',
  url: 'https://files.zilar.test/a.jpg',
  name: 'photo.jpg',
  size: 2048,
  width: 1200,
  height: 800,
};

describe('parseMediaItem', () => {
  it('parses a valid row with its optional fields', () => {
    expect(parseMediaItem(ROW)).toEqual(ROW);
  });

  it('keeps only the known shapes of the optional fields', () => {
    expect(parseMediaItem({ ...ROW, size: 'big', waveform: [0, 1, 'x'] })).toEqual({
      messageId: ROW.messageId,
      chat: ROW.chat,
      at: ROW.at,
      senderName: ROW.senderName,
      kind: ROW.kind,
      url: ROW.url,
      name: ROW.name,
      width: ROW.width,
      height: ROW.height,
    });
    expect(parseMediaItem({ ...ROW, kind: 'sticker' })).toBeNull();
  });

  it('drops malformed rows', () => {
    expect(parseMediaItem(null)).toBeNull();
    expect(parseMediaItem({ ...ROW, messageId: 7 })).toBeNull();
    expect(parseMediaItem({ ...ROW, at: undefined })).toBeNull();
    expect(parseMediaItem({ ...ROW, at: 'not-a-date' })).toBeNull();
  });
});

describe('media api client', () => {
  it('lists a page with the chat, type and paging params', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [ROW], next: '1700000000000000' }));
    const api = createMediaApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    const page = await api.listChatMedia({
      chat: 'ana@zilar.test',
      type: 'media',
      before: '1700000000000001',
      limit: 50,
    });
    expect(page).toEqual({ items: [ROW], next: '1700000000000000' });
    const [listUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(listUrl).toContain('/api/media?');
    expect(listUrl).toContain('chat=ana%40zilar.test');
    expect(listUrl).toContain('type=media');
    expect(listUrl).toContain('before=1700000000000001');
    expect(listUrl).toContain('limit=50');
  });

  it('omits before and limit when not given, and reads null next', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [], next: null }));
    const api = createMediaApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    const page = await api.listChatMedia({ chat: 'ana', type: 'voice' });
    expect(page).toEqual({ items: [], next: null });
    const [listUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(listUrl).toContain('/api/media?chat=ana&type=voice');
    expect(listUrl).not.toContain('before=');
    expect(listUrl).not.toContain('limit=');
  });

  it('drops malformed rows and keeps the good ones', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [ROW, { messageId: 7 }, { ...ROW, kind: 'sticker' }], next: null }),
    );
    const api = createMediaApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    expect(await api.listChatMedia({ chat: 'ana', type: 'media' })).toEqual({
      items: [ROW],
      next: null,
    });
  });

  it('throws unauthorized without a session', async () => {
    const api = createMediaApi(
      async () => undefined,
      (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(api.listChatMedia({ chat: 'ana', type: 'media' })).rejects.toMatchObject({
      status: 401,
    });
  });
});
