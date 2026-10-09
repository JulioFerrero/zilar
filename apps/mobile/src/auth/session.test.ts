import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Me } from '../lib/auth-api';

const mocks = vi.hoisted(() => ({
  storage: {
    getToken: vi.fn<() => Promise<string | undefined>>(),
    setToken: vi.fn<(token: string) => Promise<void>>(),
    clearToken: vi.fn<() => Promise<void>>(),
  },
  clientOptions: [] as Array<{
    baseURL: string;
    getToken?: () => string | undefined | Promise<string | undefined>;
    onToken?: (token: string) => void;
  }>,
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signOutSession: vi.fn(),
  fetchMe: vi.fn(),
  updateMe: vi.fn(),
}));

vi.mock('./secure-session-storage', () => ({
  createSecureSessionStorage: () => mocks.storage,
}));

vi.mock('../lib/auth', () => ({
  API_URL: 'https://api.test',
  createZilarAuthClient: (options: (typeof mocks.clientOptions)[number]) => {
    mocks.clientOptions.push(options);
    return { client: true };
  },
  sendSignInCode: mocks.sendSignInCode,
  verifySignInCode: mocks.verifySignInCode,
  signOutSession: mocks.signOutSession,
}));

vi.mock('../lib/auth-api', () => ({
  fetchMe: mocks.fetchMe,
  updateMe: mocks.updateMe,
}));

import { requestSignInCode, useAuthStore } from './session';

const ME: Me = { id: 'u1', email: 'ada@example.com', name: 'Ada', jid: null };

beforeEach(() => {
  mocks.storage.getToken.mockReset();
  mocks.storage.setToken.mockReset();
  mocks.storage.clearToken.mockReset();
  mocks.storage.setToken.mockResolvedValue(undefined);
  mocks.storage.clearToken.mockResolvedValue(undefined);
  mocks.sendSignInCode.mockReset();
  mocks.verifySignInCode.mockReset();
  mocks.signOutSession.mockReset();
  mocks.fetchMe.mockReset();
  mocks.updateMe.mockReset();
  useAuthStore.setState({ status: 'loading', me: null });
});

describe('requestSignInCode', () => {
  it('sends the email and invite code and answers with no error on success', async () => {
    mocks.sendSignInCode.mockResolvedValue({ data: {}, error: null });

    await expect(requestSignInCode('ada@example.com', 'INVITE')).resolves.toEqual({});

    expect(mocks.sendSignInCode).toHaveBeenCalledWith(
      { client: true },
      'ada@example.com',
      'INVITE',
    );
  });

  it('treats an undefined error as success', async () => {
    mocks.sendSignInCode.mockResolvedValue({ data: {} });

    await expect(requestSignInCode('ada@example.com')).resolves.toEqual({});
  });

  it('normalizes a client error to code, message and status', async () => {
    mocks.sendSignInCode.mockResolvedValue({
      error: { code: 'TOO_MANY_ATTEMPTS', message: 'slow down', status: 429, extra: 'dropped' },
    });

    await expect(requestSignInCode('ada@example.com')).resolves.toEqual({
      error: { code: 'TOO_MANY_ATTEMPTS', message: 'slow down', status: 429 },
    });
  });

  it('rejects with the original error when the call throws', async () => {
    const failure = new Error('offline');
    mocks.sendSignInCode.mockRejectedValue(failure);

    await expect(requestSignInCode('ada@example.com')).rejects.toBe(failure);
  });
});

describe('the session store wired to the real api shape', () => {
  it('verifies the code, stores the token and loads the profile', async () => {
    mocks.verifySignInCode.mockResolvedValue({ token: 'token-1' });
    mocks.fetchMe.mockResolvedValue(ME);

    const outcome = await useAuthStore
      .getState()
      .signIn({ email: 'ada@example.com', otp: '123456', inviteCode: 'INVITE' });

    expect(outcome).toEqual({ ok: true, me: ME });
    expect(mocks.verifySignInCode).toHaveBeenCalledWith(
      { client: true },
      'ada@example.com',
      '123456',
      'INVITE',
    );
    expect(mocks.storage.setToken).toHaveBeenCalledWith('token-1');
    expect(mocks.fetchMe).toHaveBeenCalledWith('https://api.test', 'token-1');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('answers the normalized error for a wrong code', async () => {
    mocks.verifySignInCode.mockResolvedValue({ error: { code: 'INVALID_OTP', status: 400 } });

    const outcome = await useAuthStore
      .getState()
      .signIn({ email: 'ada@example.com', otp: '000000' });

    expect(outcome).toEqual({ ok: false, error: { code: 'INVALID_OTP', status: 400 } });
    expect(mocks.storage.setToken).not.toHaveBeenCalled();
  });

  it('answers missing_token when the server sends no token', async () => {
    mocks.verifySignInCode.mockResolvedValue({});

    const outcome = await useAuthStore
      .getState()
      .signIn({ email: 'ada@example.com', otp: '123456' });

    expect(outcome).toEqual({ ok: false, error: { code: 'missing_token' } });
  });

  it('saves the name with the stored token', async () => {
    mocks.storage.getToken.mockResolvedValue('token-1');
    mocks.updateMe.mockResolvedValue(ME);

    const result = await useAuthStore.getState().setName('Ada');

    expect(result).toEqual({ ok: true });
    expect(mocks.updateMe).toHaveBeenCalledWith('https://api.test', 'token-1', 'Ada');
    expect(useAuthStore.getState().me).toEqual(ME);
  });

  it('ends the session, clears the token and becomes a guest on sign-out', async () => {
    mocks.signOutSession.mockResolvedValue(undefined);
    useAuthStore.setState({ status: 'authenticated', me: ME });

    await useAuthStore.getState().signOut();

    expect(mocks.signOutSession).toHaveBeenCalledWith({ client: true });
    expect(mocks.storage.clearToken).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('guest');
    expect(useAuthStore.getState().me).toBeNull();
  });

  it('still signs out locally when the server call fails', async () => {
    mocks.signOutSession.mockRejectedValue(new Error('offline'));
    useAuthStore.setState({ status: 'authenticated', me: ME });

    await useAuthStore.getState().signOut();

    expect(mocks.storage.clearToken).toHaveBeenCalled();
    expect(useAuthStore.getState().status).toBe('guest');
  });
});

describe('the auth client token hooks', () => {
  const options = () => {
    const first = mocks.clientOptions[0];
    if (first === undefined) {
      throw new Error('The auth client was not created');
    }
    return first;
  };

  it('points the client at the api url', () => {
    expect(options().baseURL).toBe('https://api.test');
  });

  it('reads the bearer token from the storage', async () => {
    mocks.storage.getToken.mockResolvedValue('token-1');

    await expect(options().getToken?.()).resolves.toBe('token-1');
  });

  it('stores a token the server sets', () => {
    options().onToken?.('token-2');

    expect(mocks.storage.setToken).toHaveBeenCalledWith('token-2');
  });

  it('ignores a failed token write', async () => {
    mocks.storage.setToken.mockRejectedValue(new Error('disk full'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    options().onToken?.('token-3');
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
