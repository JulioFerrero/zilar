import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '../lib/auth-api';
import { createMemorySessionStorage } from './session-storage';
import { createAuthStore, type AuthApi } from './session-store';

const ME: Me = { id: 'u1', email: 'new@example.com', name: '', jid: null };
const NAMED: Me = { ...ME, name: 'Ada' };

function makeApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    sendCode: vi.fn(async () => ({})),
    verifyCode: vi.fn(async () => ({ token: 'token-1' })),
    signOut: vi.fn(async () => undefined),
    fetchMe: vi.fn(async () => ME),
    updateMe: vi.fn(async (_token: string, name: string) => ({ ...ME, name })),
    ...overrides,
  };
}

describe('auth store bootstrap', () => {
  it('restores a persisted session', async () => {
    const api = makeApi({ fetchMe: vi.fn(async () => NAMED) });
    const store = createAuthStore({ api, storage: createMemorySessionStorage('token-1') });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('authenticated');
    expect(store.getState().me).toEqual(NAMED);
  });

  it('is a guest without a stored token', async () => {
    const api = makeApi();
    const store = createAuthStore({ api, storage: createMemorySessionStorage() });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('guest');
    expect(api.fetchMe).not.toHaveBeenCalled();
  });

  it('clears the token when the server rejects it', async () => {
    const storage = createMemorySessionStorage('stale');
    const api = makeApi({
      fetchMe: vi.fn(async () => {
        throw { status: 401, code: 'unauthorized' };
      }),
    });
    const store = createAuthStore({ api, storage });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('guest');
    await expect(storage.getToken()).resolves.toBeUndefined();
  });

  it('keeps the token on a 502 and retries until the profile loads', async () => {
    const storage = createMemorySessionStorage('token-1');
    const fetchMe = vi
      .fn<() => Promise<Me>>()
      .mockRejectedValueOnce({ status: 502, code: 'request_failed' })
      .mockResolvedValueOnce(NAMED);
    const api = makeApi({ fetchMe });
    // The retry waits on this stub, so the test drives the backoff itself.
    const waits: Array<() => void> = [];
    const store = createAuthStore({
      api,
      storage,
      wait: () =>
        new Promise<void>((resolve) => {
          waits.push(resolve);
        }),
    });
    const statuses: string[] = [];
    const unsubscribe = store.subscribe((state) => statuses.push(state.status));

    const booting = store.getState().bootstrap();
    await vi.waitFor(() => {
      expect(store.getState().status).toBe('offline');
    });
    expect(statuses).not.toContain('guest');
    await expect(storage.getToken()).resolves.toBe('token-1');

    waits.shift()?.();
    await booting;
    unsubscribe();

    expect(store.getState().status).toBe('authenticated');
    expect(store.getState().me).toEqual(NAMED);
    expect(await storage.getMe()).toEqual(NAMED);
    expect(statuses).not.toContain('guest');
  });

  it('opens on the stored profile before the fresh one loads', async () => {
    const storage = createMemorySessionStorage('token-1');
    await storage.setMe(NAMED);
    const freshMe: Me = { ...NAMED, name: 'Grace' };
    let resolveFetch!: (me: Me) => void;
    const fetchMe = vi.fn(
      () =>
        new Promise<Me>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const api = makeApi({ fetchMe });
    const store = createAuthStore({ api, storage });

    const booting = store.getState().bootstrap();
    await vi.waitFor(() => {
      expect(store.getState().status).toBe('authenticated');
    });

    // The stored profile is on screen while the background fetch is pending.
    expect(store.getState().me).toEqual(NAMED);
    expect(fetchMe).toHaveBeenCalledWith('token-1');

    resolveFetch(freshMe);
    await booting;

    expect(store.getState().me).toEqual(freshMe);
    expect(await storage.getMe()).toEqual(freshMe);
  });

  it('signs out when the background refresh is rejected', async () => {
    const storage = createMemorySessionStorage('stale');
    await storage.setMe(NAMED);
    const api = makeApi({
      fetchMe: vi.fn(async () => {
        throw { status: 401, code: 'unauthorized' };
      }),
    });
    const store = createAuthStore({ api, storage });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe('guest');
    expect(store.getState().me).toBeNull();
    await expect(storage.getToken()).resolves.toBeUndefined();
    await expect(storage.getMe()).resolves.toBeUndefined();
  });

  it('waits when there is a token but no stored profile', async () => {
    const storage = createMemorySessionStorage('token-1');
    let resolveFetch!: (me: Me) => void;
    const fetchMe = vi.fn(
      () =>
        new Promise<Me>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const api = makeApi({ fetchMe });
    const store = createAuthStore({ api, storage });

    const booting = store.getState().bootstrap();
    await vi.waitFor(() => {
      expect(fetchMe).toHaveBeenCalled();
    });

    // No cached profile: the app still shows the loading screen until the
    // profile arrives (today's behaviour).
    expect(store.getState().status).toBe('loading');

    resolveFetch(NAMED);
    await booting;

    expect(store.getState().status).toBe('authenticated');
  });
});

describe('auth store sign-in', () => {
  it('stores the token and loads the profile on success', async () => {
    const storage = createMemorySessionStorage();
    const api = makeApi();
    const store = createAuthStore({ api, storage });

    const outcome = await store.getState().signIn({ email: 'new@example.com', otp: '123456' });

    expect(outcome).toEqual({ ok: true, me: ME });
    expect(await storage.getToken()).toBe('token-1');
    expect(store.getState().status).toBe('authenticated');
  });

  it('does not sign in on a wrong code and keeps the guest state', async () => {
    const storage = createMemorySessionStorage();
    const api = makeApi({
      verifyCode: vi.fn(async () => ({ error: { code: 'INVALID_OTP' } })),
    });
    const store = createAuthStore({ api, storage });
    await store.getState().bootstrap();

    const outcome = await store.getState().signIn({ email: 'new@example.com', otp: '000000' });

    expect(outcome).toEqual({ ok: false, error: { code: 'INVALID_OTP' } });
    expect(store.getState().status).toBe('guest');
    expect(await storage.getToken()).toBeUndefined();
    expect(api.fetchMe).not.toHaveBeenCalled();
  });

  it('never logs the session token', async () => {
    const token = 'SESSION-TOKEN-SECRET-xyz789';
    const api = makeApi({ verifyCode: vi.fn(async () => ({ token })) });
    const store = createAuthStore({ api, storage: createMemorySessionStorage() });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    await store.getState().signIn({ email: 'new@example.com', otp: '123456' });

    const leaked = spies.some((spy) =>
      spy.mock.calls.some((call) => call.some((argument) => String(argument).includes(token))),
    );
    expect(leaked).toBe(false);
    spies.forEach((spy) => spy.mockRestore());
  });
});

describe('auth store name and sign-out', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the name through PATCH /api/me and only then updates the store', async () => {
    const storage = createMemorySessionStorage('token-1');
    const updateMe = vi.fn(async (_token: string, name: string) => ({ ...ME, name }));
    const api = makeApi({ updateMe });
    const store = createAuthStore({ api, storage });
    await store.getState().bootstrap();

    const result = await store.getState().setName('Ada');

    expect(result).toEqual({ ok: true });
    expect(updateMe).toHaveBeenCalledWith('token-1', 'Ada');
    expect(store.getState().me?.name).toBe('Ada');
  });

  it('keeps the cached picture when the PATCH reply carries none', async () => {
    const withPicture: Me = { ...ME, avatarUrl: 'https://x/a.png' };
    const api = makeApi({ fetchMe: vi.fn(async () => withPicture) });
    const store = createAuthStore({ api, storage: createMemorySessionStorage('token-1') });
    await store.getState().bootstrap();

    await store.getState().setName('Ada');

    expect(store.getState().me?.name).toBe('Ada');
    expect(store.getState().me?.avatarUrl).toBe('https://x/a.png');
  });

  it('keeps the old name when the PATCH fails', async () => {
    const api = makeApi({
      updateMe: vi.fn(async () => {
        throw { status: 500, code: 'request_failed' };
      }),
    });
    const store = createAuthStore({ api, storage: createMemorySessionStorage('token-1') });
    await store.getState().bootstrap();

    const result = await store.getState().setName('Ada');

    expect(result.ok).toBe(false);
    expect(store.getState().me?.name).toBe('');
  });

  it('sign-out clears the stored session even when the server call fails', async () => {
    const storage = createMemorySessionStorage('token-1');
    const api = makeApi({
      signOut: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const store = createAuthStore({ api, storage });
    await store.getState().bootstrap();

    await store.getState().signOut();

    expect(store.getState().status).toBe('guest');
    expect(store.getState().me).toBeNull();
    await expect(storage.getToken()).resolves.toBeUndefined();
    expect(api.signOut).toHaveBeenCalled();
  });
});
