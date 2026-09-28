import { describe, expect, it, vi } from 'vitest';
import { createProviderProbe, redactKey } from './probe';

function fakeFetch(status: number) {
  return vi.fn(async (_input: string, _init: RequestInit) => new Response(null, { status }));
}

describe('provider probe', () => {
  it('sends the key to the provider and reports ok on a 2xx', async () => {
    const fetchImpl = fakeFetch(200);
    const probe = createProviderProbe(fetchImpl);

    const outcome = await probe.testKey('openai', 'sk-fake-1234');

    expect(outcome).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-fake-1234');
  });

  it('reports a rejected key on 401 and 403', async () => {
    for (const status of [401, 403]) {
      const probe = createProviderProbe(fakeFetch(status));
      expect(await probe.testKey('anthropic', 'sk-fake-1234')).toEqual({
        ok: false,
        message: 'The provider rejected the key',
      });
    }
  });

  it('reports an unexpected response on other failures', async () => {
    const probe = createProviderProbe(fakeFetch(500));
    expect(await probe.testKey('deepseek', 'sk-fake-1234')).toEqual({
      ok: false,
      message: 'The provider returned an unexpected response',
    });
  });

  it('reports unreachable without echoing the key from a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED https://generativelanguage.googleapis.com?key=sk-fake-1234');
    });
    const probe = createProviderProbe(fetchImpl);

    const outcome = await probe.testKey('google', 'sk-fake-1234');

    expect(outcome).toEqual({ ok: false, message: 'The provider is unreachable' });
    expect(JSON.stringify(outcome)).not.toContain('sk-fake-1234');
  });

  it('puts the key in the query for Google', async () => {
    const fetchImpl = fakeFetch(200);
    const probe = createProviderProbe(fetchImpl);

    await probe.testKey('google', 'sk-fake-1234');

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('key=sk-fake-1234');
  });
});

describe('redactKey', () => {
  it('removes the exact key and credential-shaped keys from a message', () => {
    const message = 'boom: sk-fake-1234 and sk-other-token-abc';
    expect(redactKey(message, 'sk-fake-1234')).not.toContain('sk-fake-1234');
    expect(redactKey(message, 'sk-fake-1234')).not.toContain('sk-other-token-abc');
  });
});
