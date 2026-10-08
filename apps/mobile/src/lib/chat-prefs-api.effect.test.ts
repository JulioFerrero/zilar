import { describe, expect, it, vi } from 'vitest';

import { createChatPrefsApi, parseChatPref } from './chat-prefs-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('chat-prefs schema', () => {
  it('drops an unknown extra field', () => {
    expect(
      parseChatPref({
        chatJid: 'ana@zilar.test',
        mutedUntil: null,
        archived: false,
        pinnedAt: null,
        updatedAt: '2026-09-30T11:00:00Z',
        extra: 1,
      }),
    ).toEqual({
      chatJid: 'ana@zilar.test',
      mutedUntil: null,
      archived: false,
      pinnedAt: null,
      updatedAt: '2026-09-30T11:00:00Z',
    });
  });

  it('rejects a non-null, non-string mutedUntil', () => {
    expect(
      parseChatPref({
        chatJid: 'ana@zilar.test',
        mutedUntil: 5,
        archived: false,
        pinnedAt: null,
        updatedAt: '2026-09-30T11:00:00Z',
      }),
    ).toBeNull();
  });

  it('keeps a valid error code when the message is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'locked', message: 123 } }, 403),
    );
    const api = createChatPrefsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listChatPrefs()).rejects.toMatchObject({
      status: 403,
      code: 'locked',
      message: 'Request failed (403)',
    });
  });

  it('keeps a valid error message when the code is malformed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 123, message: 'Prefs unavailable' } }, 403),
    );
    const api = createChatPrefsApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.listChatPrefs()).rejects.toMatchObject({
      status: 403,
      code: 'request_failed',
      message: 'Prefs unavailable',
    });
  });
});
