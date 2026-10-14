// T-1396: the pinned fetch is the only door to a user's base URL. These tests
// use an injected resolver and transport, so no test opens a real socket.
import { describe, expect, it } from 'vitest';
import { createPinnedFetch, PinnedFetchError, type PinnedTransport } from './pinned-fetch';

const PUBLIC = async (): Promise<readonly string[]> => ['93.184.216.34'];
const okTransport: PinnedTransport = () => Promise.resolve(new Response('ok'));

describe('createPinnedFetch', () => {
  it('refuses a request to a host other than the configured one', async () => {
    const fetchPinned = createPinnedFetch('https://api.example.com/v1', {
      resolver: PUBLIC,
      transport: okTransport,
    });

    await expect(
      fetchPinned('https://evil.example.com/v1/models', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PinnedFetchError);
  });

  it('refuses a different port on the same host', async () => {
    const fetchPinned = createPinnedFetch('https://api.example.com/v1', {
      resolver: PUBLIC,
      transport: okTransport,
    });

    await expect(
      fetchPinned('https://api.example.com:8443/v1/models', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PinnedFetchError);
  });

  it('does not follow a redirect', async () => {
    const transport: PinnedTransport = () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example.com/steal' },
        }),
      );
    const fetchPinned = createPinnedFetch('https://api.example.com/v1', {
      resolver: PUBLIC,
      transport,
    });

    const response = await fetchPinned('https://api.example.com/v1/models', { method: 'GET' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://evil.example.com/steal');
  });

  it('refuses a host that re-resolves to a private address on the second call', async () => {
    let calls = 0;
    const resolver = async (): Promise<readonly string[]> => {
      calls += 1;
      return calls === 1 ? ['93.184.216.34'] : ['10.0.0.1'];
    };
    const fetchPinned = createPinnedFetch('https://api.example.com/v1', {
      resolver,
      transport: okTransport,
    });

    const first = await fetchPinned('https://api.example.com/v1/models', { method: 'GET' });
    expect(first.status).toBe(200);

    await expect(
      fetchPinned('https://api.example.com/v1/models', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PinnedFetchError);
  });

  it('refuses a refused DNS answer', async () => {
    const fetchPinned = createPinnedFetch('https://api.example.com/v1', {
      resolver: async () => ['127.0.0.1'],
      transport: okTransport,
    });

    await expect(
      fetchPinned('https://api.example.com/v1/models', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PinnedFetchError);
  });
});
