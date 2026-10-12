import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_TIMEOUT_MS, fetchWithTimeout } from './fetch-timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects after the timeout when the fetch never settles', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = fetchWithTimeout(fetchImpl, 'http://server.test/api/x', {}, API_TIMEOUT_MS);
    const assertion = expect(pending).rejects.toThrow('The operation was aborted.');
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1);
    await expect(
      Promise.race([pending.then(() => 'settled'), Promise.resolve('pending')]),
    ).resolves.toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('arms the timeout when the caller passes a signal (derived-client path)', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = fetchWithTimeout(
      fetchImpl,
      'http://server.test/api/x',
      { signal: caller.signal },
      API_TIMEOUT_MS,
    );
    const assertion = expect(pending).rejects.toThrow('The operation was aborted.');
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('a caller abort fails the fetch before the timeout', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const pending = fetchWithTimeout(
      fetchImpl,
      'http://server.test/api/x',
      { signal: caller.signal },
      API_TIMEOUT_MS,
    );
    const assertion = expect(pending).rejects.toThrow('The operation was aborted.');
    caller.abort();
    await assertion;
  });
});
