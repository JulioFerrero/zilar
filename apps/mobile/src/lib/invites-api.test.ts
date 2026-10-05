import { describe, expect, it, vi } from 'vitest';

import { createInvitesApi, InvitesApiError } from './invites-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const INVITE = {
  code: 'abc123',
  url: 'https://chat.zilar.app/invite/abc123',
  expiresAt: '2026-10-12T00:00:00.000Z',
};

describe('createInvitesApi', () => {
  it('POSTs /api/invites with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(INVITE));
    const api = createInvitesApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).resolves.toEqual(INVITE);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/invites');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('accepts an invite without expiresAt', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: 'abc123', url: 'https://chat.zilar.app/invite/abc123' }),
    );
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).resolves.toEqual({
      code: 'abc123',
      url: 'https://chat.zilar.app/invite/abc123',
    });
  });

  it('throws unauthorized without a session token and never calls fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(INVITE));
    const api = createInvitesApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).rejects.toBeInstanceOf(InvitesApiError);
    await expect(api.createInvite()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a body missing code or url as invalid_response', async () => {
    for (const broken of [{ url: INVITE.url }, { code: INVITE.code }, { nope: true }]) {
      const fetchImpl = vi.fn(async () => jsonResponse(broken));
      const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

      await expect(api.createInvite()).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });

  it('keeps the server error code and status for HTTP errors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'rate_limited', message: 'slow down' } }, 429),
    );
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).rejects.toBeInstanceOf(InvitesApiError);
    await expect(api.createInvite()).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createInvitesApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.createInvite()).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});
