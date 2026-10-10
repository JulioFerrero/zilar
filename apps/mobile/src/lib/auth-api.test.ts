import { describe, expect, it, vi } from 'vitest';

import { AuthApiError, checkInvite, fetchMe, updateMe } from './auth-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ME = { id: 'u1', email: 'you@example.com', name: 'Ada', jid: 'you@zilar.localhost' };

describe('fetchMe', () => {
  it('GETs /api/me with the bearer token and parses the profile', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ME)) as unknown as typeof fetch;

    const me = await fetchMe('http://server.test', 'token-1', fetchImpl);

    expect(me).toEqual(ME);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://server.test/api/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('rejects a non-2xx with the server error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'Authentication required' } }, 401),
    ) as unknown as typeof fetch;

    await expect(fetchMe('http://server.test', 'bad', fetchImpl)).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthorized',
    });
  });

  it('rejects an unexpected body shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true })) as unknown as typeof fetch;

    await expect(fetchMe('http://server.test', 'token-1', fetchImpl)).rejects.toBeInstanceOf(
      AuthApiError,
    );
  });
});

describe('updateMe', () => {
  it('PATCHes /api/me with the name', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...ME, name: 'Grace' }),
    ) as unknown as typeof fetch;

    const me = await updateMe('http://server.test', 'token-1', 'Grace', fetchImpl);

    expect(me.name).toBe('Grace');
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ name: 'Grace' }));
  });
});

describe('checkInvite', () => {
  it('returns the valid flag', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ valid: true })) as unknown as typeof fetch;
    await expect(checkInvite('http://server.test', 'code 1', fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('http://server.test/api/invites/code%201', {
      headers: { accept: 'application/json' },
    });
  });

  it('returns false on an invalid invite', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ valid: false })) as unknown as typeof fetch;
    await expect(checkInvite('http://server.test', 'gone', fetchImpl)).resolves.toBe(false);
  });
});
