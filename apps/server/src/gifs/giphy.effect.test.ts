// The Effect conversion (T-0485): a resolver failure and a hung fetch both
// settle the plain `Promise` API with the neutral `GiphyError`. Fakes only —
// no network, and fake timers drive the 10 s timeout without waiting it out.
import { describe, expect, it, vi } from 'vitest';
import { createGiphyProvider, GiphyError } from './giphy';

describe('createGiphyProvider effect conversion', () => {
  it('maps a resolver failure to a GiphyError', async () => {
    const provider = createGiphyProvider({
      apiKey: 'test-key',
      rating: 'pg-13',
      resolver: () => Promise.reject(new Error('dns down')),
    });
    await expect(provider.search('cat', { limit: 25 })).rejects.toBeInstanceOf(GiphyError);
  });

  it('maps a hung fetch to a GiphyError once the timeout passes', async () => {
    vi.useFakeTimers();
    try {
      const provider = createGiphyProvider({
        apiKey: 'test-key',
        rating: 'pg-13',
        resolver: () => Promise.resolve(['93.184.216.34']),
        fetcher: () => new Promise<{ status: number; body: string }>(() => {}),
      });
      const pending = provider.search('cat', { limit: 25 });
      const rejected = expect(pending).rejects.toBeInstanceOf(GiphyError);
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
