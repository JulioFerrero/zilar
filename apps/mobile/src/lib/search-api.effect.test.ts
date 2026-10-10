import { describe, expect, it, vi } from 'vitest';

import { createSearchApi } from './search-api';
import { jsonResponse } from '@/test/wait';

const ITEM = {
  chatJid: 'ana',
  messageId: 'ana-12',
  senderName: 'Ana',
  at: '2026-09-28T12:30:00.000Z',
  snippet: 'terrace',
  marks: [[0, 7]],
};

describe('search schema', () => {
  it('drops unknown extra fields at the page and item level', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [{ ...ITEM, extra: true }], nextBefore: 'c', extra: 1 }),
    );
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).resolves.toEqual({
      items: [ITEM],
      nextBefore: 'c',
    });
  });

  it('rejects a mark with more than two offsets', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [{ ...ITEM, marks: [[0, 1, 2]] }] }));
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });

  it('keeps a valid error code when the message is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'invalid_request', message: 123 } }, 400),
    );
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: 'Request failed (400)',
    });
  });

  it('keeps a valid error message when the code is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 123, message: 'Bad query' } }, 400),
    );
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.searchMessages({ q: 'terrace' })).rejects.toMatchObject({
      status: 400,
      code: 'request_failed',
      message: 'Bad query',
    });
  });

  it('lets a cancel win when an error response arrives', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      return jsonResponse({ error: { code: 'invalid_request', message: 'Bad query' } }, 400);
    });
    const api = createSearchApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(
      api.searchMessages({ q: 'terrace', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
