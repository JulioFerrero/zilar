import { describe, expect, it, vi } from 'vitest';

import {
  ContactsApiError,
  contactChatId,
  createContactsApi,
  domainOfJid,
  normalizeHandleInput,
  type ContactRequestView,
  type HandleProfile,
} from './contacts-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PROFILE: HandleProfile = {
  userId: 'u-ada',
  name: 'Ada',
  handle: 'ada',
  image: null,
  relation: 'none',
};

const REQUEST: ContactRequestView = {
  id: 'req-1',
  status: 'pending',
  createdAt: '2026-10-03T10:00:00.000Z',
  other: { userId: 'u-ada', name: 'Ada', handle: 'ada', image: null },
};

describe('normalizeHandleInput', () => {
  it('strips a leading @, trims and lowercases', () => {
    expect(normalizeHandleInput('@Ada')).toBe('ada');
    expect(normalizeHandleInput('  ADA  ')).toBe('ada');
    expect(normalizeHandleInput('ada')).toBe('ada');
    expect(normalizeHandleInput('')).toBe('');
  });
});

describe('domainOfJid', () => {
  it('takes the domain off a bare JID', () => {
    expect(domainOfJid('ana@zilar.test')).toBe('zilar.test');
    expect(domainOfJid('ana@zilar.test/zilar')).toBe('zilar.test');
  });

  it('rejects anything that is not a bare user JID', () => {
    expect(domainOfJid(null)).toBeUndefined();
    expect(domainOfJid(undefined)).toBeUndefined();
    expect(domainOfJid('no-at-sign')).toBeUndefined();
    expect(domainOfJid('two@at@signs')).toBeUndefined();
    expect(domainOfJid('ana@')).toBeUndefined();
  });
});

describe('contactChatId', () => {
  it('lowercases the user id into the JID localpart', () => {
    expect(contactChatId('U-Ada', 'zilar.test')).toBe('u-ada@zilar.test');
  });
});

describe('createContactsApi', () => {
  it('GETs the lookup with the handle URL-encoded', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PROFILE));
    const api = createContactsApi(
      async () => 'session-token',
      fetchImpl as unknown as typeof fetch,
    );

    await expect(api.lookupByHandle('ada')).resolves.toEqual(PROFILE);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/users/by-handle/ada');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
    expect(init.method).toBe('GET');
  });

  it('accepts each relation value', async () => {
    const relations = ['none', 'contact', 'request_sent', 'request_received', 'self'] as const;
    for (const relation of relations) {
      const fetchImpl = vi.fn(async () => jsonResponse({ ...PROFILE, relation }));
      const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);
      await expect(api.lookupByHandle('ada')).resolves.toMatchObject({ relation });
    }
  });

  it('POSTs the send with the handle body and reads the incoming flag', async () => {
    const row = {
      id: 'req-1',
      fromUserId: 'u-me',
      toUserId: 'u-ada',
      status: 'pending',
      createdAt: '2026-10-03T10:00:00.000Z',
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ request: row, incoming: true }));
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const created = await api.sendContactRequest('ada');
    expect(created).toEqual({ request: row, incoming: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/contact-requests');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ handle: 'ada' });
  });

  it('lists incoming and outgoing requests', async () => {
    const list = { incoming: [REQUEST], outgoing: [] };
    const fetchImpl = vi.fn(async () => jsonResponse(list));
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const result = await api.listContactRequests();
    expect(result).toEqual(list);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/contact-requests');
  });

  it('accepts, declines and cancels with the right methods', async () => {
    const decided = {
      request: {
        id: 'req-1',
        fromUserId: 'u-ada',
        toUserId: 'u-me',
        status: 'accepted',
        createdAt: '2026-10-03T10:00:00.000Z',
      },
    };
    const fetchImpl = vi.fn(async () => jsonResponse(decided));
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.acceptContactRequest('req-1')).resolves.toEqual(decided);
    await expect(api.declineContactRequest('req-1')).resolves.toEqual(decided);
    await expect(api.cancelContactRequest('req-1')).resolves.toEqual(decided);

    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe('http://127.0.0.1:3188/api/contact-requests/req-1/accept');
    expect(calls[0]?.[1].method).toBe('POST');
    expect(calls[1]?.[0]).toBe('http://127.0.0.1:3188/api/contact-requests/req-1/decline');
    expect(calls[1]?.[1].method).toBe('POST');
    expect(calls[2]?.[0]).toBe('http://127.0.0.1:3188/api/contact-requests/req-1');
    expect(calls[2]?.[1].method).toBe('DELETE');
  });

  it('keeps the server error code and status for 404', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'No user with that username' } }, 404),
    );
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.lookupByHandle('nobody')).rejects.toBeInstanceOf(ContactsApiError);
    await expect(api.lookupByHandle('nobody')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('keeps the server error code and status for 429', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
        429,
      ),
    );
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listContactRequests()).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('keeps the server error code and status for 409', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 'already_contact', message: 'You are already contacts' } },
        409,
      ),
    );
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.sendContactRequest('ada')).rejects.toMatchObject({
      status: 409,
      code: 'already_contact',
    });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.lookupByHandle('ada')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.lookupByHandle('ada')).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(api.listContactRequests()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a profile whose relation is not in the enum', async () => {
    const broken = { ...PROFILE, relation: 'maybe' };
    const fetchImpl = vi.fn(async () => jsonResponse(broken));
    const api = createContactsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.lookupByHandle('ada')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createContactsApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.lookupByHandle('ada')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
