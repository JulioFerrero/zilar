import { describe, expect, it, vi } from 'vitest';

import {
  avatarFileName,
  avatarPutPath,
  checkHandlePath,
  createProfileApi,
  parseApiErrorBody,
  ProfileApiError,
} from './profile-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function api(fetchImpl: ReturnType<typeof vi.fn>) {
  return createProfileApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);
}

describe('checkHandlePath', () => {
  it('encodes the handle as a query param', () => {
    expect(checkHandlePath('ada lovelace')).toBe('/api/handles/check?handle=ada+lovelace');
  });
});

describe('avatarPutPath', () => {
  it('PUTs to the user avatar slot', () => {
    expect(avatarPutPath('user 1')).toBe('/api/avatars/user/user%201');
  });
});

describe('avatarFileName', () => {
  it('names the export from its mime type', () => {
    expect(avatarFileName('image/png')).toBe('avatar.png');
    expect(avatarFileName('image/webp')).toBe('avatar.webp');
    expect(avatarFileName('image/jpeg')).toBe('avatar.jpg');
    expect(avatarFileName('image/jpeg; charset=binary')).toBe('avatar.jpg');
  });
});

describe('parseApiErrorBody', () => {
  it('pulls code and message from the error envelope', () => {
    expect(parseApiErrorBody({ error: { code: 'handle_taken', message: 'Taken' } })).toEqual({
      code: 'handle_taken',
      message: 'Taken',
    });
  });

  it('falls back to request_failed without an envelope', () => {
    expect(parseApiErrorBody({ nope: true })).toEqual({ code: 'request_failed', message: null });
  });
});

describe('createProfileApi profile', () => {
  it('GETs /api/me with the bearer header and parses handle and avatar', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'u1',
        email: 'you@example.com',
        name: 'Ada',
        handle: 'ada',
        avatarUrl: '/api/avatars/abc',
        jid: 'you@zilar.localhost',
        createdAt: '2026-09-28T00:00:00.000Z',
      }),
    );

    await expect(api(fetchImpl).getMe()).resolves.toEqual({
      id: 'u1',
      email: 'you@example.com',
      name: 'Ada',
      handle: 'ada',
      avatarUrl: '/api/avatars/abc',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/me');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('reads a missing handle and avatar as null (older servers)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: 'u1', email: 'you@example.com', name: 'Ada' }),
    );

    await expect(api(fetchImpl).getMe()).resolves.toEqual({
      id: 'u1',
      email: 'you@example.com',
      name: 'Ada',
      handle: null,
    });
  });

  it('rejects an unexpected profile shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));

    await expect(api(fetchImpl).getMe()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('createProfileApi handles', () => {
  it('checks a handle with the bearer header', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ available: true }));
    const result = await api(fetchImpl).checkHandle('ada');

    expect(result).toEqual({ available: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/handles/check?handle=ada');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('reports the server reason when taken', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ available: false, reason: 'taken' }));

    await expect(api(fetchImpl).checkHandle('ada')).resolves.toEqual({
      available: false,
      reason: 'taken',
    });
  });

  it('reports invalid and reserved reasons', async () => {
    const invalid = vi.fn(async () => jsonResponse({ available: false, reason: 'invalid' }));
    await expect(api(invalid).checkHandle('a')).resolves.toEqual({
      available: false,
      reason: 'invalid',
    });

    const reserved = vi.fn(async () => jsonResponse({ available: false, reason: 'reserved' }));
    await expect(api(reserved).checkHandle('admin')).resolves.toEqual({
      available: false,
      reason: 'reserved',
    });
  });

  it('claims a handle with PUT and the exact body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ handle: 'ada' }));

    await expect(api(fetchImpl).claimHandle('ada')).resolves.toEqual({ handle: 'ada' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/me/handle');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ handle: 'ada' }));
  });

  it('keeps the handle_taken code and status on a lost race', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'handle_taken', message: 'That username is taken' } }, 409),
    );

    await expect(api(fetchImpl).claimHandle('ada')).rejects.toBeInstanceOf(ProfileApiError);
    await expect(api(fetchImpl).claimHandle('ada')).rejects.toMatchObject({
      status: 409,
      code: 'handle_taken',
      message: 'That username is taken',
    });
  });

  it('keeps handle_reserved, handle_invalid and rate_limited on claim', async () => {
    for (const [status, code] of [
      [400, 'handle_invalid'],
      [409, 'handle_reserved'],
      [429, 'rate_limited'],
    ] as const) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ error: { code, message: `${code} happened` } }, status),
      );
      await expect(api(fetchImpl).claimHandle('admin')).rejects.toMatchObject({ status, code });
    }
  });

  it('keeps handle_change_too_soon with the server message (next-change date)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'handle_change_too_soon',
            message: 'Next change possible on 10/10/2026',
            nextChangeAt: '2026-10-10T00:00:00.000Z',
          },
        },
        409,
      ),
    );

    await expect(api(fetchImpl).claimHandle('ada')).rejects.toMatchObject({
      status: 409,
      code: 'handle_change_too_soon',
      message: 'Next change possible on 10/10/2026',
    });
  });

  it('reports a network failure as network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(api(fetchImpl).checkHandle('ada')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const noSession = createProfileApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(noSession.checkHandle('ada')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an unexpected check shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));

    await expect(api(fetchImpl).checkHandle('ada')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('createProfileApi avatars', () => {
  const blob = new Blob(['bytes'], { type: 'image/jpeg' });

  it('PUTs the avatar bytes with their content type', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ url: '/api/avatars/abc' }));

    await expect(api(fetchImpl).uploadAvatar('user-1', blob)).resolves.toEqual({
      url: '/api/avatars/abc',
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/avatars/user/user-1');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('uploads a local file through the injected native uploader', async () => {
    const fetchImpl = vi.fn();
    const uploader = vi.fn(async () => ({ url: '/api/avatars/abc' }));

    await expect(api(fetchImpl).uploadAvatar('user-1', blob, uploader)).resolves.toEqual({
      url: '/api/avatars/abc',
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(uploader).toHaveBeenCalledWith(
      'http://127.0.0.1:3188/api/avatars/user/user-1',
      'image/jpeg',
    );
  });

  it('rejects an unexpected upload response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));

    await expect(api(fetchImpl).uploadAvatar('user-1', blob)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('keeps the avatar error codes (too large, not square, animated)', async () => {
    for (const code of ['avatar_too_large', 'avatar_not_square', 'avatar_animated'] as const) {
      const status = code === 'avatar_too_large' ? 413 : 400;
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ error: { code, message: `${code} happened` } }, status),
      );
      await expect(api(fetchImpl).uploadAvatar('user-1', blob)).rejects.toMatchObject({
        status,
        code,
      });
    }
  });

  it('DELETEs the avatar slot and accepts the empty `{ ok: true }` body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    await expect(api(fetchImpl).removeAvatar('user-1')).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/avatars/user/user-1');
    expect(init.method).toBe('DELETE');
  });

  it('answers 404 for an unknown owner like for a forbidden one', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Avatar not found' } }, 404),
    );

    await expect(api(fetchImpl).removeAvatar('user-1')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });
});
