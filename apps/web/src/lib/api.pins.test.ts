import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import { ApiError, listPins, pinMessage, unpinMessage, type Pin } from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { resetMockApi, setMockDelay } from '@/mock/api';

const mockEnabled = vi.mocked(isMockApiEnabled);

const PIN: Pin = {
  id: 'pin-1',
  chat: 'ana@zilar.test',
  messageId: 'm-1',
  senderName: 'Ana',
  text: 'Booked ✅',
  kind: 'text',
  pinnedBy: 'u-1',
  pinnedAt: '2026-10-09T10:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(response: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pins API over the contract client (T-0864)', () => {
  it('lists with a relative same-origin path, json accept and same-origin cookies', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { pins: [PIN] }));

    expect(await listPins('ana@zilar.test')).toEqual([PIN]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/pins?chat=ana%40zilar.test');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  });

  it('pins with a JSON string body and a trimmed sender name', async () => {
    const fetchMock = stubFetch(() => jsonResponse(201, PIN));

    const created = await pinMessage({
      chat: 'ana@zilar.test',
      messageId: 'm-1',
      senderName: ' Ana ',
      text: 'Booked ✅',
      kind: 'text',
    });
    expect(created).toEqual(PIN);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/pins');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      chat: 'ana@zilar.test',
      messageId: 'm-1',
      senderName: 'Ana',
      text: 'Booked ✅',
      kind: 'text',
    });
  });

  it('unpins with the id encoded into the path', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, PIN));

    await expect(unpinMessage('pin/1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/pins/pin%2F1');
    expect(init?.method).toBe('DELETE');
  });

  it('rejects with ApiError carrying the envelope code and detail', async () => {
    stubFetch(() =>
      jsonResponse(409, {
        error: { code: 'pin_exists', message: 'Already pinned', requestId: 'r-1', pinId: 'p-9' },
      }),
    );

    const error = await listPins('ana').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'pin_exists', message: 'Already pinned' });
    expect((error as ApiError).detail).toEqual({ pinId: 'p-9' });
  });

  it('rejects with network_error when fetch throws, and invalid_response on a bad body', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    await expect(listPins('ana')).rejects.toMatchObject({ status: 0, code: 'network_error' });

    stubFetch(() => jsonResponse(200, { pins: [{ ...PIN, messageId: 7 }] }));
    await expect(listPins('ana')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('reaches a fetch stub installed after the first call', async () => {
    stubFetch(() => jsonResponse(200, { pins: [] }));
    expect(await listPins('ana')).toEqual([]);

    const second = stubFetch(() => jsonResponse(200, { pins: [PIN] }));
    expect(await listPins('ana@zilar.test')).toEqual([PIN]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('answers from the mock backend in mock mode without touching fetch', async () => {
    mockEnabled.mockReturnValue(true);
    resetMockApi();
    setMockDelay(0);
    const fetchMock = stubFetch(() => jsonResponse(500, {}));

    const created = await pinMessage({
      chat: 'c-mock',
      messageId: 'm-1',
      senderName: 'You',
      text: 'hello',
      kind: 'text',
    });
    expect(created).toMatchObject({ chat: 'c-mock', messageId: 'm-1', text: 'hello' });
    expect((await listPins('c-mock')).map((pin) => pin.id)).toEqual([created.id]);
    await unpinMessage(created.id);
    expect(await listPins('c-mock')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
