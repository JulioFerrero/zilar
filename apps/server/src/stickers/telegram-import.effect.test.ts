import { describe, expect, it, vi } from 'vitest';
import { createTelegramClient, TelegramImportError } from './telegram-import';

// The conversion adds the abort-on-timeout path: `Effect.tryPromise` hands
// `fetch` an `AbortSignal`, which the 10 s timer aborts. The existing test
// covers the retry-by-clock behaviour; this one proves the signal is real
// and that a request which honours it fails as `try_later`.
describe('createTelegramClient timeout (Effect conversion)', () => {
  it('aborts the fetch when the 10 s timeout elapses, then reports try_later', async () => {
    // Only `setTimeout` is faked: Effect's scheduler still uses the real
    // `setImmediate`, so the fiber keeps making progress while the fake
    // clock advances. Effect's own `sleep` is not used on this path.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const seen: { signal: AbortSignal | null } = { signal: null };
      const hangingFetch: typeof fetch = ((_url: unknown, init?: RequestInit) => {
        const signal = (init?.signal as AbortSignal | undefined) ?? null;
        seen.signal = signal;
        return new Promise<Response>((_resolve, reject) => {
          const abort = (): void => reject(new DOMException('Aborted', 'AbortError'));
          if (signal !== null && signal.aborted) {
            abort();
            return;
          }
          signal?.addEventListener('abort', abort);
        });
      }) as typeof fetch;

      const client = createTelegramClient('TEST-TOKEN', hangingFetch);
      const pending = client.getMe().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      const error = await pending;

      expect(seen.signal).not.toBeNull();
      expect(seen.signal?.aborted).toBe(true);
      expect(error).toBeInstanceOf(TelegramImportError);
      expect((error as TelegramImportError).code).toBe('try_later');
      expect(String((error as Error).message)).not.toContain('TEST-TOKEN');
    } finally {
      vi.useRealTimers();
    }
  });
});

// The edge catch-all (the old `scrubbed()`): a defect must not escape as a
// `FiberFailure` that carries the token-bearing URL; it becomes the fixed
// `try_later` error.
describe('createTelegramClient edge catch-all (Effect conversion)', () => {
  it('maps an unexpected defect to try_later without leaking the token', async () => {
    // A 3xx response is drained by `discardBody`, whose `arrayBuffer` throws
    // a non-Error synchronously — a genuine defect, not a typed failure.
    const defectFetch: typeof fetch = (async () => ({
      status: 302,
      body: null,
      arrayBuffer: (): never => {
        throw 'unexpected-non-error';
      },
    })) as unknown as typeof fetch;

    const client = createTelegramClient('TEST-TOKEN', defectFetch);
    const error = await client.getMe().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(TelegramImportError);
    expect((error as TelegramImportError).code).toBe('try_later');
    expect((error as Error).message).toBe('Could not reach Telegram, try again later');
    const serialised = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(serialised).not.toContain('TEST-TOKEN');
  });
});
