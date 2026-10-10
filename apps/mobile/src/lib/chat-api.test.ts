import { describe, expect, it, vi } from 'vitest';

import { ChatApiError, createChatApi } from './chat-api';
import { jsonResponse } from '@/test/wait';

describe('createChatApi', () => {
  it('sends the bearer token and parses the chat list', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        chats: [
          { kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
          {
            kind: 'group',
            chatJid: 'team@rooms.zilar.test',
            title: 'Team',
            groupId: 'g1',
            memberCount: 3,
            role: 'member',
          },
        ],
      }),
    );
    const api = createChatApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    const chats = await api.getChats();

    expect(chats).toHaveLength(2);
    expect(chats[0]).toEqual({
      kind: 'dm',
      chatJid: 'ana@zilar.test',
      title: 'Ana',
      userId: 'u-ana',
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3188/api/chats');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer session-token');
  });

  it('parses isAi on DM entries, absent on older servers and human DMs', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        chats: [
          {
            kind: 'dm',
            chatJid: 'bot@zilar.test',
            title: 'Bot',
            userId: 'u-bot',
            isAi: true,
          },
          { kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
        ],
      }),
    );
    const api = createChatApi(async () => 'session-token', fetchImpl as unknown as typeof fetch);

    const chats = await api.getChats();

    expect(chats[0]).toEqual({
      kind: 'dm',
      chatJid: 'bot@zilar.test',
      title: 'Bot',
      userId: 'u-bot',
      isAi: true,
    });
    expect(chats[1]).not.toHaveProperty('isAi');
  });

  it('parses the profile, contacts, group and XMPP token', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/me')) {
        return jsonResponse({ id: 'u-me', email: 'me@zilar.test', name: 'Me', jid: null });
      }
      if (url.endsWith('/api/contacts')) {
        return jsonResponse([{ userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' }]);
      }
      if (url.includes('/api/groups/')) {
        return jsonResponse({
          id: 'g1',
          title: 'Team',
          createdBy: 'u-me',
          members: [{ userId: 'u-ana', name: 'Ana', role: 'member' }],
        });
      }
      return jsonResponse({
        jid: 'me@zilar.test',
        token: 'jwt',
        expiresAt: '2026-09-28T12:05:00Z',
        service: 'ws://x',
        domain: 'zilar.test',
        mucDomain: 'rooms.zilar.test',
      });
    });
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getMe()).resolves.toEqual({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
      jid: null,
    });
    await expect(api.getContacts()).resolves.toEqual([
      { userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' },
    ]);
    await expect(api.getGroup('g1')).resolves.toMatchObject({ id: 'g1', title: 'Team' });
    await expect(api.getXmppToken()).resolves.toMatchObject({
      jid: 'me@zilar.test',
      token: 'jwt',
    });
  });

  it('parses member roles for the chips, absent on older servers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'g1',
        title: 'Team',
        createdBy: 'u-me',
        members: [
          {
            userId: 'u-ana',
            name: 'Ana',
            role: 'admin',
            roles: [{ id: 'role-designers', name: 'Designers' }],
          },
          { userId: 'u-luis', name: 'Luis', role: 'member' },
        ],
      }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getGroup('g1')).resolves.toMatchObject({
      members: [
        {
          userId: 'u-ana',
          name: 'Ana',
          role: 'admin',
          roles: [{ id: 'role-designers', name: 'Designers' }],
        },
        { userId: 'u-luis', name: 'Luis', role: 'member', roles: [] },
      ],
    });
  });

  it('rejects a group detail with malformed member roles', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'g1',
        title: 'Team',
        createdBy: 'u-me',
        members: [{ userId: 'u-ana', name: 'Ana', role: 'admin', roles: [{ id: 'r1' }] }],
      }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getGroup('g1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('parses the channel fields on entries and the detail', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/api/chats')) {
        return jsonResponse({
          chats: [
            {
              kind: 'group',
              chatJid: 'acme@rooms.zilar.test',
              title: 'Acme Announcements',
              groupId: 'g-acme',
              memberCount: 4,
              role: 'member',
              chatKind: 'channel',
              subscriberCount: 4,
              description: 'Release notes.',
            },
          ],
        });
      }
      return jsonResponse({
        id: 'g-acme',
        title: 'Acme Announcements',
        createdBy: 'u-rita',
        kind: 'channel',
        description: 'Release notes.',
        members: [],
      });
    });
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).resolves.toEqual([
      {
        kind: 'group',
        chatJid: 'acme@rooms.zilar.test',
        title: 'Acme Announcements',
        groupId: 'g-acme',
        memberCount: 4,
        role: 'member',
        chatKind: 'channel',
        subscriberCount: 4,
        description: 'Release notes.',
      },
    ]);
    await expect(api.getGroup('g-acme')).resolves.toMatchObject({
      kind: 'channel',
      description: 'Release notes.',
    });
  });

  it('still parses older servers without the channel fields', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        chats: [
          {
            kind: 'group',
            chatJid: 'team@rooms.zilar.test',
            title: 'Team',
            groupId: 'g1',
            memberCount: 3,
            role: 'member',
          },
        ],
      }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).resolves.toEqual([
      {
        kind: 'group',
        chatJid: 'team@rooms.zilar.test',
        title: 'Team',
        groupId: 'g1',
        memberCount: 3,
        role: 'member',
      },
    ]);
  });

  it('rejects a group entry with a malformed channel kind', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        chats: [
          {
            kind: 'group',
            chatJid: 'team@rooms.zilar.test',
            title: 'Team',
            groupId: 'g1',
            memberCount: 3,
            role: 'member',
            chatKind: 'broadcast',
          },
        ],
      }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('parses member handles, absent or null on older servers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'g1',
        title: 'Team',
        createdBy: 'u-me',
        members: [
          { userId: 'u-ana', name: 'Ana', role: 'member', handle: 'ana' },
          { userId: 'u-luis', name: 'Luis', role: 'member' },
          { userId: 'u-mia', name: 'Mia', role: 'member', handle: null },
          { userId: 'u-noa', name: 'Noa', role: 'member', handle: '' },
        ],
      }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getGroup('g1')).resolves.toMatchObject({
      members: [
        { userId: 'u-ana', name: 'Ana', role: 'member', handle: 'ana' },
        { userId: 'u-luis', name: 'Luis', role: 'member' },
        { userId: 'u-mia', name: 'Mia', role: 'member' },
        { userId: 'u-noa', name: 'Noa', role: 'member' },
      ],
    });
  });

  it('rejects a group detail with a malformed member handle', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'g1',
        title: 'Team',
        createdBy: 'u-me',
        members: [{ userId: 'u-ana', name: 'Ana', role: 'member', handle: 7 }],
      }),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getGroup('g1')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('throws a typed error on a failed request', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'unauthorized', message: 'No session' } }, 401),
    );
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).rejects.toBeInstanceOf(ChatApiError);
    await expect(api.getChats()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('rejects an unexpected response shape', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));
    const api = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);

    await expect(api.getChats()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('fails before the network when there is no session', async () => {
    const fetchImpl = vi.fn();
    const api = createChatApi(async () => undefined, fetchImpl as unknown as typeof fetch);

    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
