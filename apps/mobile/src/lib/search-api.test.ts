import { describe, expect, it, vi } from 'vitest';

import { SearchApiError, createSearchApi } from './search-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PAGE = {
  items: [
    {
      chatJid: 'ana',
      messageId: 'ana-12',
      senderName: 'Ana',
      at: '2026-09-28T12:30:00.000Z',
      snippet: 'that other place with the terrace',
      marks: [[24, 31]],
    },
  ],
  nextBefore: '1720000000000000',
};

describe('createSearchApi', () => {
  it('validates the response and pages with the cursor', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAGE));
    const api = createSearchApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    const page = await api.searchMessages({ q: 'terrace', limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.nextBefore).toBe('1720000000000000');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/search?q=terrace&limit=20');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('scopes to one chat and forwards the cursor', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }));
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.searchMessages({ q: 'terrace', chat: 'ana', before: '1720000000000000' });

    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('chat=ana');
    expect(url).toContain('before=1720000000000000');
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects hostile marks (negative or non-integer offsets)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [{ ...PAGE.items[0], marks: [[-1, 4]] }] }),
    );
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('keeps the server code for rate limits and unavailability', async () => {
    const limited = vi.fn(async () =>
      jsonResponse({ error: { code: 'rate_limited', message: 'Too many' } }, 429),
    );
    const api = createSearchApi(async () => 't', limited as unknown as typeof fetch);
    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });

    const gone = vi.fn(async () =>
      jsonResponse({ error: { code: 'search_unavailable', message: 'No search' } }, 501),
    );
    const api2 = createSearchApi(async () => 't', gone as unknown as typeof fetch);
    await expect(api2.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      status: 501,
      code: 'search_unavailable',
    });
  });

  it('treats an abort as an AbortError, not a search failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const error = await api
      .searchMessages({ q: 'terrace', signal: controller.signal })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DOMException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createSearchApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never sends the query anywhere except the search URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }));
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await api.searchMessages({ q: 'DROP TABLE archive; --' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('http://127.0.0.1:3188/api/search?')).toBe(true);
  });

  it('is a SearchApiError with status and code', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'invalid_request', message: 'Bad' } }, 400),
    );
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const error = await api.searchMessages({ q: 'x' }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(SearchApiError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_request' });
  });
});
