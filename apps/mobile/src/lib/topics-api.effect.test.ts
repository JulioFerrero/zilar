import { describe, expect, it, vi } from 'vitest';

import { createTopicsApi, TopicsApiError } from './topics-api';

function apiFor(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return createTopicsApi(
    async () => 'session-token',
    fetchImpl as unknown as typeof fetch,
    'http://127.0.0.1:3188',
  );
}

describe('topics-api Effect pipeline', () => {
  it('maps a network throw to network_error', async () => {
    const api = apiFor(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(api.getTopic('t-1')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
  });

  it('keeps per-field fallbacks on a non-JSON error body', async () => {
    const api = apiFor(async () => new Response('not json', { status: 500 }));
    await expect(api.getTopic('t-1')).rejects.toMatchObject({
      status: 500,
      code: 'request_failed',
      message: 'Request failed (500)',
    });
  });

  it('fails with unauthorized before touching the network', async () => {
    const fetchImpl = vi.fn();
    const api = createTopicsApi(
      async () => undefined,
      fetchImpl as unknown as typeof fetch,
      'http://127.0.0.1:3188',
    );
    const error = await api.getTopic('t-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TopicsApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
