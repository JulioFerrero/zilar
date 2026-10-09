import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { checkHandle, claimHandle, isRateLimited, suggestHandleFor } from './handles';

// The real api.ts request runs against a stubbed fetch (mock mode is off in tests).
function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

describe('handles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('suggests a handle from the display name, then the email local part', () => {
    expect(suggestHandleFor('Ana Lopez')).toBe('ana_lopez');
    expect(suggestHandleFor('', 'ana.lopez@zilar.test')).toBe('ana_lopez');
    expect(suggestHandleFor('a', undefined)).toBe('a00');
  });

  it('falls back to "user" when neither source gives a valid handle', () => {
    expect(suggestHandleFor('!!!', '')).toBe('user');
    expect(suggestHandleFor('admin')).toBe('user');
  });

  it('checkHandle returns the API answer', async () => {
    stubFetch(200, { available: false, reason: 'taken' });
    await expect(checkHandle('bob_b')).resolves.toEqual({ available: false, reason: 'taken' });
  });

  it('claimHandle returns the claimed handle', async () => {
    stubFetch(200, { handle: 'ana_lopez' });
    await expect(claimHandle('ana_lopez')).resolves.toEqual({ handle: 'ana_lopez' });
  });

  it('passes an API rejection through unchanged, so ApiError and isRateLimited still match', async () => {
    stubFetch(429, { error: { code: 'rate_limited', message: 'slow down' } });

    const rejection = await checkHandle('bob_b').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection instanceof ApiError).toBe(true);
    expect(rejection).toMatchObject({ status: 429, code: 'rate_limited', message: 'slow down' });
    expect(isRateLimited(rejection)).toBe(true);
  });
});
