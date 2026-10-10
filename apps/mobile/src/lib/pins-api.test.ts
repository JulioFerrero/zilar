import { describe, expect, it, vi } from 'vitest';

import {
  createPinsApi,
  parsePin,
  parsePinKind,
  pinKindFor,
  pinLabel,
  pinSnapshotText,
  PinsApiError,
  type Pin,
} from './pins-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const ROW: Pin = {
  id: 'pin-1',
  chat: 'ana',
  messageId: 'ana-11',
  senderName: 'You',
  text: 'Booked for 21:00 ✅',
  kind: 'text',
  pinnedBy: 'me',
  pinnedAt: '2026-09-30T11:00:00Z',
};

describe('parsePin', () => {
  it('parses a valid row and falls back to text for an unknown kind', () => {
    expect(parsePin(ROW)).toEqual(ROW);
    expect(parsePin({ ...ROW, kind: 'sticker' })).toMatchObject({ kind: 'text' });
    expect(parsePinKind('voice')).toBe('voice');
  });

  it('drops malformed rows', () => {
    expect(parsePin(null)).toBeNull();
    expect(parsePin({ ...ROW, messageId: 7 })).toBeNull();
  });
});

describe('pins api client', () => {
  it('lists pins with the chat as a query param', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ pins: [ROW] }));
    const api = createPinsApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    expect(await api.listPins('ana@zilar.test')).toEqual([ROW]);
    const [listUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(listUrl).toContain('/api/pins?chat=ana%40zilar.test');
  });

  it('pins with a snapshot and echoes the deleted row on unpin', async () => {
    const postImpl = vi.fn(async () => jsonResponse(ROW, 201));
    const api = createPinsApi(async () => 'tok', postImpl as typeof fetch, 'http://127.0.0.1:3188');
    expect(
      await api.pinMessage({
        chat: 'ana',
        messageId: 'ana-11',
        senderName: 'You',
        text: 'Booked for 21:00 ✅',
        kind: 'text',
      }),
    ).toEqual(ROW);

    const deleteImpl = vi.fn(async () => jsonResponse(ROW));
    const deleteApi = createPinsApi(
      async () => 'tok',
      deleteImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    expect(await deleteApi.unpinMessage('pin-1')).toEqual(ROW);
    const [deleteUrl] = deleteImpl.mock.calls[0] as unknown as [string];
    expect(deleteUrl).toContain('/api/pins/pin-1');
  });

  it('throws unauthorized without a session', async () => {
    const api = createPinsApi(
      async () => undefined,
      (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await expect(api.listPins('ana')).rejects.toMatchObject({ status: 401 });
  });

  it('sends the bearer token, json headers and a string body (T-0864)', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(ROW, 201));
    const api = createPinsApi(
      async () => 'tok',
      fetchImpl as typeof fetch,
      'http://127.0.0.1:3188',
    );
    await api.pinMessage({
      chat: 'ana',
      messageId: 'ana-11',
      senderName: ' You ',
      text: 'Booked for 21:00 ✅',
      kind: 'text',
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3188/api/pins');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      accept: 'application/json',
      authorization: 'Bearer tok',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      chat: 'ana',
      messageId: 'ana-11',
      senderName: 'You',
      text: 'Booked for 21:00 ✅',
      kind: 'text',
    });
  });

  it('rejects with PinsApiError for the envelope, the network and a bad body (T-0864)', async () => {
    const make = (response: () => Promise<Response>) =>
      createPinsApi(async () => 'tok', response as typeof fetch, 'http://127.0.0.1:3188');

    const limited = await make(async () =>
      jsonResponse({ error: { code: 'pin_limit', message: 'Too many pins' } }, 400),
    )
      .listPins('ana')
      .catch((error: unknown) => error);
    expect(limited).toBeInstanceOf(PinsApiError);
    expect(limited).toMatchObject({ status: 400, code: 'pin_limit', message: 'Too many pins' });

    await expect(
      make(async () => Promise.reject(new Error('offline'))).listPins('ana'),
    ).rejects.toMatchObject({ status: 0, code: 'network_error' });
    await expect(
      make(async () => jsonResponse({ pins: 'nope' })).listPins('ana'),
    ).rejects.toMatchObject({ status: 200, code: 'invalid_response' });
    await expect(
      make(async () => jsonResponse({ pins: [{ ...ROW, kind: 'sticker' }] })).listPins('ana'),
    ).resolves.toEqual([{ ...ROW, kind: 'text' }]);
  });
});

describe('pin snapshots', () => {
  it('snaps text up to 300 chars, attachments carry no text', () => {
    expect(pinKindFor({ text: 'hi' })).toBe('text');
    expect(pinKindFor({ image: {} })).toBe('image');
    expect(pinKindFor({ voice: {} })).toBe('voice');
    expect(pinKindFor({ card: {} })).toBe('card');
    expect(pinSnapshotText({ text: 'a'.repeat(400) })).toHaveLength(300);
    expect(pinSnapshotText({ image: {} })).toBe('');
    expect(pinSnapshotText({ text: 'gone', deleted: true })).toBe('Message deleted');
  });

  it('labels text or the attachment kind', () => {
    expect(pinLabel({ text: 'hello', kind: 'text' })).toBe('hello');
    expect(pinLabel({ text: '', kind: 'image' })).toBe('Photo');
    expect(pinLabel({ text: '  ', kind: 'voice' })).toBe('Voice message');
  });
});
