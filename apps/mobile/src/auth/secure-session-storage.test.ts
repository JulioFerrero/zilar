import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  setItemAsync: vi.fn<(key: string, value: string) => Promise<void>>(),
  deleteItemAsync: vi.fn<(key: string) => Promise<void>>(),
}));

vi.mock('expo-secure-store', () => secureStore);

import { createSecureSessionStorage, SESSION_TOKEN_KEY } from './secure-session-storage';

beforeEach(() => {
  secureStore.getItemAsync.mockReset();
  secureStore.setItemAsync.mockReset();
  secureStore.deleteItemAsync.mockReset();
  secureStore.setItemAsync.mockResolvedValue(undefined);
  secureStore.deleteItemAsync.mockResolvedValue(undefined);
});

describe('createSecureSessionStorage', () => {
  it('reads the token from the session key', async () => {
    secureStore.getItemAsync.mockResolvedValue('token-1');

    await expect(createSecureSessionStorage().getToken()).resolves.toBe('token-1');

    expect(secureStore.getItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
  });

  it('answers undefined for a missing token', async () => {
    secureStore.getItemAsync.mockResolvedValue(null);

    await expect(createSecureSessionStorage().getToken()).resolves.toBeUndefined();
  });

  it('answers undefined for an empty token', async () => {
    secureStore.getItemAsync.mockResolvedValue('');

    await expect(createSecureSessionStorage().getToken()).resolves.toBeUndefined();
  });

  it('rejects with the original error when the read fails', async () => {
    const failure = new Error('keychain locked');
    secureStore.getItemAsync.mockRejectedValue(failure);

    await expect(createSecureSessionStorage().getToken()).rejects.toBe(failure);
  });

  it('writes the token under the session key', async () => {
    await expect(createSecureSessionStorage().setToken('token-2')).resolves.toBeUndefined();

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY, 'token-2');
  });

  it('rejects with the original error when the write fails', async () => {
    const failure = new Error('disk full');
    secureStore.setItemAsync.mockRejectedValue(failure);

    await expect(createSecureSessionStorage().setToken('token-2')).rejects.toBe(failure);
  });

  it('deletes the session key on clear', async () => {
    await expect(createSecureSessionStorage().clearToken()).resolves.toBeUndefined();

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_TOKEN_KEY);
  });

  it('rejects with the original error when the delete fails', async () => {
    const failure = new Error('keychain locked');
    secureStore.deleteItemAsync.mockRejectedValue(failure);

    await expect(createSecureSessionStorage().clearToken()).rejects.toBe(failure);
  });
});
