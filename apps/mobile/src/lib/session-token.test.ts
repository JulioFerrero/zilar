import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionToken } from './session-token';

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn<() => Promise<string | undefined>>() }));

// The real storage imports expo-secure-store, which Vitest (Node) cannot load.
vi.mock('../auth/secure-session-storage', () => ({
  createSecureSessionStorage: () => ({ getToken }),
}));

beforeEach(() => {
  getToken.mockReset();
});

describe('getSessionToken (T-0811)', () => {
  it('resolves the token the secure storage holds', async () => {
    getToken.mockResolvedValue('session-token-1');

    await expect(getSessionToken()).resolves.toBe('session-token-1');
  });

  it('resolves undefined when no token is stored', async () => {
    getToken.mockResolvedValue(undefined);

    await expect(getSessionToken()).resolves.toBeUndefined();
  });

  it('rejects with the same error the storage rejects with', async () => {
    const boom = new Error('keychain locked');
    getToken.mockRejectedValue(boom);

    await expect(getSessionToken()).rejects.toBe(boom);
  });
});
