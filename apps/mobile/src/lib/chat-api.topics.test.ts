import { describe, expect, it, vi } from 'vitest';

import { ChatApiError, createChatApi } from './chat-api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function generalTopic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-g',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: 'general@rooms.zilar.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
    archived: false,
    memberCount: 6,
    ais: [],
    ...overrides,
  };
}

function groupEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'group',
    chatJid: 'general@rooms.zilar.test',
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    ...overrides,
  };
}

describe('parseChat keeps group topics (T-0139)', () => {
  it('keeps a General-only group topics so the store maps it to a topic row', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ chats: [groupEntry({ topics: [generalTopic()] })] }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const chats = await api.getChats();

    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ kind: 'group', groupId: 'g1' });
    expect((chats[0] as { topics?: unknown[] }).topics).toHaveLength(1);
  });

  it('parses groups without topics like before (older servers)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ chats: [groupEntry()] }));
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const chats = await api.getChats();

    expect(chats).toHaveLength(1);
    expect(chats[0]).toEqual(groupEntry());
  });

  it('drops malformed topic rows but keeps the group', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ chats: [groupEntry({ topics: [{ nope: true }, generalTopic()] })] }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    const chats = await api.getChats();

    expect(chats).toHaveLength(1);
    expect((chats[0] as { topics?: unknown[] }).topics).toHaveLength(1);
  });

  it('rejects a non-array topics field as a malformed entry', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ chats: [groupEntry({ topics: 'nope' })] }));
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('still rejects a group entry with a bad shape', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ chats: [{ ...groupEntry(), memberCount: 'many' }] }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(api.getChats()).rejects.toBeInstanceOf(ChatApiError);
  });
});
