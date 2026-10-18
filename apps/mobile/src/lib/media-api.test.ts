import { describe, expect, it, vi } from 'vitest';

import { createMediaApi } from './media-api';
import { jsonResponse } from '@/test/wait';

const ROW = {
  messageId: 'm1',
  chat: 'room@zilar.localhost',
  at: '2026-10-18T12:00:00.000Z',
  senderName: 'Ada',
  kind: 'image',
  url: 'https://x/a.png',
};

describe('createMediaApi', () => {
  it('drops a row whose date cannot be parsed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        items: [ROW, { ...ROW, messageId: 'm2', at: 'not-a-date' }],
        next: '123',
      }),
    ) as unknown as typeof fetch;
    const api = createMediaApi(async () => 'token-1', fetchImpl, 'http://server.test');

    const page = await api.listChatMedia({ chat: ROW.chat, type: 'media' });

    expect(page.items.map((item) => item.messageId)).toEqual(['m1']);
    expect(page.next).toBe('123');
  });
});
