import { describe, expect, it, vi } from 'vitest';

import { createChatPrefsApi, parseChatPref, type ChatPref } from './chat-prefs-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('parseChatPref', () => {
  it('parses a valid row', () => {
    expect(
      parseChatPref({
        chatJid: 'ana@zilar.test',
        mutedUntil: null,
        archived: false,
        pinnedAt: null,
        updatedAt: '2026-09-30T11:00:00Z',
      }),
    ).toMatchObject({ chatJid: 'ana@zilar.test', archived: false });
  });

  it('drops malformed rows', () => {
    expect(parseChatPref(null)).toBeNull();
    expect(
      parseChatPref({ chatJid: 'a', archived: 'yes', updatedAt: 'x', mutedUntil: null }),
    ).toBeNull();
    expect(parseChatPref({ chatJid: 'a', archived: false, updatedAt: 'x' })).toBeNull();
  });
});

describe('chat-prefs api client', () => {
  const row: ChatPref = {
    chatJid: 'ana@zilar.test',
    mutedUntil: null,
    archived: false,
    pinnedAt: null,
    updatedAt: '2026-09-30T11:00:00Z',
  };

  it('lists prefs and answers the saved row on PUT', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prefs: [row] }));
    const api = createChatPrefsApi(async () => 'tok', fetchImpl as typeof fetch);
    expect(await api.listChatPrefs()).toEqual([row]);

    const putImpl = vi.fn(async () => jsonResponse(row));
    const putApi = createChatPrefsApi(async () => 'tok', putImpl as typeof fetch);
    expect(await putApi.putChatPref('ana@zilar.test', { archived: true })).toEqual(row);
    const [putUrl] = putImpl.mock.calls[0] as unknown as [string];
    expect(putUrl).toContain('/api/chat-prefs/ana%40zilar.test');
  });

  it('answers null when the write landed on defaults (row deleted)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prefs: null }));
    const api = createChatPrefsApi(async () => 'tok', fetchImpl as typeof fetch);
    expect(await api.putChatPref('ana@zilar.test', { archived: false })).toBeNull();
  });

  it('throws unauthorized without a session', async () => {
    const api = createChatPrefsApi(async () => undefined, (async () => {
      throw new Error('must not fetch');
    }) as typeof fetch);
    await expect(api.listChatPrefs()).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a malformed server row', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ prefs: [{ nope: true }] }));
    const api = createChatPrefsApi(async () => 'tok', fetchImpl as typeof fetch);
    await expect(api.listChatPrefs()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
