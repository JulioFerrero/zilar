import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/mock/gate', () => ({
  isMockApiEnabled: vi.fn(() => false),
}));

import {
  ApiError,
  checkGroupHandle,
  checkHandle,
  claimHandle,
  getContacts,
  listBlockedUsers,
  searchDirectory,
  searchMessages,
  sendContactRequest,
} from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { jsonResponseAt as jsonResponse } from '@/test/wait';

const mockEnabled = vi.mocked(isMockApiEnabled);

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

describe('chain C groups over the contract client (T-0894)', () => {
  it('lists contacts and blocked people as plain arrays', async () => {
    const contact = { userId: 'u-1', name: 'Ana', jid: 'ana@zilar.test' };
    const fetchMock = stubFetch(() => jsonResponse(200, [contact]));
    expect(await getContacts()).toEqual([contact]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/contacts');

    const person = { userId: 'u-2', name: 'Bo', handle: null, image: null, jid: null };
    stubFetch(() => jsonResponse(200, { blocked: [person] }));
    expect(await listBlockedUsers()).toEqual([person]);
  });

  it('keeps the incoming flag of a reverse contact request (200) and none on a new one (201)', async () => {
    const row = {
      id: 'r-1',
      fromUserId: 'u-1',
      toUserId: 'u-2',
      status: 'pending',
      createdAt: '2026-10-10T10:00:00.000Z',
    };
    const fetchMock = stubFetch(() => jsonResponse(200, { request: row, incoming: true }));
    expect(await sendContactRequest('bob_b')).toEqual({ request: row, incoming: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/contact-requests');
    expect(init?.body).toBe(JSON.stringify({ handle: 'bob_b' }));

    stubFetch(() => jsonResponse(201, { request: row }));
    expect(await sendContactRequest('bob_b')).toEqual({ request: row });
  });

  it('answers a handle outside 1..64 characters as invalid without a request', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { available: true }));
    expect(await checkHandle('')).toEqual({ available: false, reason: 'invalid' });
    expect(await checkGroupHandle('x'.repeat(65))).toEqual({ available: false, reason: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(await checkGroupHandle('club')).toEqual({ available: true });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/handles/check?handle=club&kind=group');
  });

  it('sends exactly the keys it set: no null for an unset optional field', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { handle: 'ada' }));
    await claimHandle('ada');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/me/handle');
    expect(init).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String(init?.body))).toEqual({ handle: 'ada' });

    const search = stubFetch(() => jsonResponse(200, { items: [] }));
    await searchMessages({ q: 'concert' });
    expect(search.mock.calls[0]![0]).toBe('/api/search?q=concert');

    const directory = stubFetch(() => jsonResponse(200, { entries: [], next: null }));
    await searchDirectory();
    expect(directory.mock.calls[0]![0]).toBe('/api/directory');
  });

  it('leaves out an empty directory query and cursor', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { entries: [], next: null }));
    expect(await searchDirectory({ q: '', kind: 'channel', cursor: '' })).toEqual({
      entries: [],
      next: null,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/directory?kind=channel');
  });

  it('sends the search cursor as a number string and returns the page', async () => {
    const item = {
      chatJid: 'ana@zilar.test',
      messageId: 'o-1',
      senderName: 'Ana',
      at: '2026-10-10T10:00:00.000Z',
      snippet: 'concert tickets',
      marks: [[0, 7]],
    };
    const fetchMock = stubFetch(() => jsonResponse(200, { items: [item], nextBefore: '42' }));
    const page = await searchMessages({ q: 'concert', limit: 5, before: '99' });
    expect(page).toEqual({ items: [item], nextBefore: '42' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/search?q=concert&limit=5&before=99');
  });

  it('rejects an aborted search with an AbortError, not an ApiError', async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const pending = searchMessages({ q: 'concert', signal: controller.signal });
    controller.abort();
    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect(error).not.toBeInstanceOf(ApiError);

    const already = await searchMessages({ q: 'concert', signal: controller.signal }).catch(
      (reason: unknown) => reason,
    );
    expect(already).toMatchObject({ name: 'AbortError' });
  });

  it('maps a 501 from search to an ApiError with the server code', async () => {
    stubFetch(() =>
      jsonResponse(501, { error: { code: 'search_unavailable', message: 'not configured' } }),
    );
    const error = await searchMessages({ q: 'concert' }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 501, code: 'search_unavailable' });
  });
});
