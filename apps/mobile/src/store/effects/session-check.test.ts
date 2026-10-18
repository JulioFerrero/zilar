import { ApiError } from '@zilar/api-contract';
import { describe, expect, it, vi } from 'vitest';

import { checkSession, sessionGone } from './ports';

describe('checkSession (T-1223)', () => {
  it('a missing token reads as the session gone', async () => {
    await expect(checkSession(async () => undefined, vi.fn())).resolves.toBe('gone');
  });

  it('a 200 reads as the session valid', async () => {
    const getMe = vi.fn(async () => ({ id: 'u-me' }));

    await expect(checkSession(async () => 'token-1', getMe)).resolves.toBe('valid');
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('a 401 reads as the session gone', async () => {
    const getMe = vi.fn(async () => {
      throw new ApiError(401, 'unauthorized', 'No session');
    });

    await expect(checkSession(async () => 'token-1', getMe)).resolves.toBe('gone');
  });

  it('any other failure reads as unknown, never a sign-out', async () => {
    const network = vi.fn(async () => {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    });
    const forbidden = vi.fn(async () => {
      throw new ApiError(403, 'forbidden', 'Forbidden');
    });

    await expect(checkSession(async () => 'token-1', network)).resolves.toBe('unknown');
    await expect(checkSession(async () => 'token-1', forbidden)).resolves.toBe('unknown');
  });
});

describe('sessionGone (T-1223)', () => {
  it('signs out through the session store', async () => {
    const signOut = vi.fn(async () => undefined);

    await sessionGone(signOut);

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the sign-out fails', async () => {
    const signOut = vi.fn(async () => {
      throw new Error('keychain locked');
    });

    await expect(sessionGone(signOut)).resolves.toBeUndefined();
  });
});
