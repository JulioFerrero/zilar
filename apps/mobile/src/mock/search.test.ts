import { describe, expect, it } from 'vitest';

import { SearchApiError } from '../lib/search-api';
import { createMockSearchApi } from './search';

describe('createMockSearchApi', () => {
  it('finds mock messages newest-first with character marks', async () => {
    const api = createMockSearchApi();

    const page = await api.searchMessages({ q: 'terrace' });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.chatJid).toBe('ana');
    const first = page.items[0];
    expect(first).toBeDefined();
    if (first !== undefined) {
      const [start, end] = first.marks[0] ?? [-1, -1];
      expect([...first.snippet].slice(start, end).join('').toLowerCase()).toBe('terrace');
    }
    for (let index = 1; index < page.items.length; index += 1) {
      expect(page.items[index - 1]?.at >= (page.items[index]?.at ?? '')).toBe(true);
    }
  });

  it('narrows to one chat and rejects short queries like the server', async () => {
    const api = createMockSearchApi();

    const page = await api.searchMessages({ q: 'terrace', chat: 'ana' });
    expect(page.items.every((item) => item.chatJid === 'ana')).toBe(true);

    const other = await api.searchMessages({ q: 'terrace', chat: 'sara' });
    expect(other.items).toEqual([]);

    await expect(api.searchMessages({ q: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(api.searchMessages({ q: 'x' })).rejects.toBeInstanceOf(SearchApiError);
  });

  it('pages with the cursor and keeps snippets short', async () => {
    const api = createMockSearchApi();

    const first = await api.searchMessages({ q: 'the', limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextBefore).toBeDefined();
    for (const item of first.items) {
      expect([...item.snippet].length).toBeLessThanOrEqual(60 + [...'the'].length + 90 + 1);
    }

    const second = await api.searchMessages({ q: 'the', limit: 2, before: first.nextBefore });
    expect(second.items.length).toBeGreaterThan(0);
    const firstIds = new Set(first.items.map((item) => item.messageId));
    expect(second.items.every((item) => !firstIds.has(item.messageId))).toBe(true);
  });

  it('treats an abort as an AbortError', async () => {
    const api = createMockSearchApi();
    const controller = new AbortController();
    controller.abort();

    const error = await api
      .searchMessages({ q: 'terrace', signal: controller.signal })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DOMException);
  });
});
