import { describe, expect, it, vi } from 'vitest';

import { createGifsApi, GifsApiError, gifMediaUrl, parseGifItem } from './gifs-api';

const API = 'http://127.0.0.1:3188';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gif-1',
    title: 'dancing cat',
    mediaToken: 'tok-1',
    kind: 'image',
    width: 200,
    height: 150,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('gifs api (T-0148)', () => {
  it('builds the same-origin proxy URL for a media token', () => {
    expect(gifMediaUrl('tok-1', API)).toBe('http://127.0.0.1:3188/api/gifs/media/tok-1');
  });

  it('parses a result row into a proxied preview URL', () => {
    expect(parseGifItem(row(), API)).toEqual({
      id: 'gif-1',
      title: 'dancing cat',
      url: 'http://127.0.0.1:3188/api/gifs/media/tok-1',
      kind: 'image',
      width: 200,
      height: 150,
    });
  });

  it('drops hostile rows: wrong hosts are impossible (opaque token), oversized garbage fails', () => {
    expect(parseGifItem(row({ mediaToken: '' }), API)).toBeNull();
    expect(parseGifItem(row({ kind: 'audio' }), API)).toBeNull();
    expect(parseGifItem(row({ title: 'x'.repeat(101) }), API)).toBeNull();
    expect(parseGifItem(row({ width: 0 }), API)).toBeNull();
    expect(parseGifItem(row({ width: 5000 }), API)).toBeNull();
    expect(parseGifItem(null, API)).toBeNull();
  });

  it('keeps an optional size when it is a non-negative integer', () => {
    expect(parseGifItem(row({ sizeBytes: 123 }), API)?.sizeBytes).toBe(123);
    expect(parseGifItem(row({ sizeBytes: -1 }), API)).toBeNull();
  });

  it('searches with the query and the pos cursor, trending without a query', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [row()], nextPos: '25' }));
    const api = createGifsApi(async () => 'tok', fetchImpl, API);
    const page = await api.searchGifs('cat', '12');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calls = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = calls;
    expect(url).toBe('http://127.0.0.1:3188/api/gifs/search?q=cat&pos=12');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
    expect(page.nextPos).toBe('25');
    expect(page.items).toHaveLength(1);

    const trendingFetch = vi.fn(async () => jsonResponse(200, { items: [] }));
    await createGifsApi(async () => 'tok', trendingFetch, API).trendingGifs();
    const trendingCalls = trendingFetch.mock.calls[0] as unknown as [string, RequestInit];
    const [trendingUrl] = trendingCalls;
    expect(trendingUrl).toBe('http://127.0.0.1:3188/api/gifs/trending');
  });

  it('sends the bearer to our own API origin, never cross-origin', async () => {
    // The client only ever calls our own API: the URL is built from the
    // configured apiUrl, and the Authorization header rides that same call.
    // This inspects the actual fetch call — the URL host and the header —
    // so it fails if the token ever reaches a non-API origin.
    const fetchImpl = vi.fn(async () => jsonResponse(200, { items: [] }));
    const api = createGifsApi(async () => 'tok', fetchImpl, API);
    await api.trendingGifs();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(new URL(url).origin).toBe(new URL(API).origin);
    expect(headers['authorization']).toBe('Bearer tok');
  });

  it('maps 501 to gifs_unavailable and 429 to rate_limited', async () => {
    const down = createGifsApi(
      async () => 'tok',
      (async () =>
        jsonResponse(501, { error: { code: 'gifs_unavailable', message: 'off' } })) as typeof fetch,
      API,
    );
    await expect(down.trendingGifs()).rejects.toMatchObject({
      status: 501,
      code: 'gifs_unavailable',
    });
    const limited = createGifsApi(
      async () => 'tok',
      (async () =>
        jsonResponse(429, { error: { code: 'rate_limited', message: 'slow' } })) as typeof fetch,
      API,
    );
    await expect(limited.searchGifs('cat')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('throws unauthorized without a session and network_error when unreachable', async () => {
    const noSession = createGifsApi(
      async () => undefined,
      (async () => {
        throw new Error('unreachable');
      }) as typeof fetch,
      API,
    );
    await expect(noSession.trendingGifs()).rejects.toBeInstanceOf(GifsApiError);
    const down = createGifsApi(
      async () => 'tok',
      (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      API,
    );
    await expect(down.trendingGifs()).rejects.toMatchObject({ code: 'network_error' });
  });

  it('aborts a superseded search with AbortError, never a mapped error', async () => {
    const controller = new AbortController();
    controller.abort();
    const api = createGifsApi(
      async () => 'tok',
      (async () => jsonResponse(200, { items: [] })) as typeof fetch,
      API,
    );
    await expect(api.searchGifs('cat', undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('drops one malformed row and keeps the rest', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { items: [row(), { id: '', kind: 'audio' }] }),
    );
    const page = await createGifsApi(async () => 'tok', fetchImpl, API).trendingGifs();
    expect(page.items).toHaveLength(1);
  });
});
