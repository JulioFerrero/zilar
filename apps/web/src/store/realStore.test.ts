import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, XmppCore, XmppCoreOptions } from '@galena/xmpp-core';
import { createRealChatStore, type ApiClient, type StorageLike } from './realStore';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function message(overrides: Partial<ChatMessage> & { chatJid: string; body: string }): ChatMessage {
  return {
    id: `m-${overrides.body}`,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: 'ana@galena.test',
    fromResolved: true,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

interface FakeXmpp {
  core: XmppCore;
  history: Record<string, ChatMessage[]>;
  options: { current?: XmppCoreOptions };
  emit: (event: string, payload: unknown) => void;
}

function fakeXmpp(): FakeXmpp {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const history: Record<string, ChatMessage[]> = {};
  const options: { current?: XmppCoreOptions } = {};

  const core = {
    status: () => 'online' as const,
    me: () => 'me@galena.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: () => [],
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    loadHistory: vi.fn(
      async (chatJid: string, _kind: unknown, opts?: { before?: string; max?: number }) => {
        const list = history[chatJid] ?? [];
        const max = opts?.max ?? 50;
        let end = list.length;
        if (opts?.before !== undefined) {
          const index = list.findIndex((item) => item.id === opts.before);
          end = index === -1 ? list.length : index;
        }
        const start = Math.max(0, end - max);
        const messages = list.slice(start, end);
        return { messages, complete: start === 0, first: messages[0]?.id };
      },
    ),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: ((event: string, callback: (payload: unknown) => void) => {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
      };
    }) as unknown as XmppCore['on'],
  } as unknown as XmppCore;

  return {
    core,
    history,
    options,
    emit: (event, payload) => {
      for (const callback of listeners.get(event) ?? []) {
        callback(payload);
      }
    },
  };
}

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@galena.test',
      name: 'Me',
      image: null,
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
      {
        kind: 'group' as const,
        chatJid: 'team@rooms.galena.test',
        title: 'Team',
        groupId: 'g1',
        memberCount: 3,
        role: 'member' as const,
      },
    ]),
    getContacts: vi.fn(async () => [{ userId: 'u-ana', name: 'Ana', jid: 'ana@galena.test' }]),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@galena.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'galena.test',
      mucDomain: 'rooms.galena.test',
    })),
    createGroup: vi.fn(async () => ({
      id: 'g2',
      title: 'New',
      createdBy: 'u-me',
      members: [],
    })),
    createInvite: vi.fn(async () => ({ code: 'c', url: 'http://x/invite/c' })),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setup(overrides: Partial<ApiClient> = {}) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  xmpp.history['ana@galena.test'] = [
    message({
      id: 'ana-1',
      chatJid: 'ana@galena.test',
      body: 'older',
      timestamp: new Date('2026-09-28T09:00:00Z'),
    }),
    message({
      id: 'ana-2',
      chatJid: 'ana@galena.test',
      body: 'newest',
      timestamp: new Date('2026-09-28T10:00:00Z'),
    }),
  ];
  xmpp.history['team@rooms.galena.test'] = [
    message({
      id: 'team-1',
      chatJid: 'team@rooms.galena.test',
      body: 'group hello',
      fromJid: 'ana@galena.test',
      fromNick: 'ana',
      timestamp: new Date('2026-09-28T11:00:00Z'),
    }),
  ];

  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp };
}

describe('createRealChatStore', () => {
  it('loads chats with their last message, sorted by recency', async () => {
    const { store } = await setup();

    const chats = store.getState().chats;
    expect(chats.map((chat) => chat.id)).toEqual(['team@rooms.galena.test', 'ana@galena.test']);
    expect(chats.find((chat) => chat.id === 'ana@galena.test')?.lastMessage?.text).toBe('newest');
    expect(chats.find((chat) => chat.id === 'team@rooms.galena.test')?.lastMessage?.text).toBe(
      'group hello',
    );
    expect(store.getState().currentUserId).toBe('u-me');
  });

  it('updates the preview and unread count from a live message', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'ana-3',
        chatJid: 'ana@galena.test',
        body: 'live one',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@galena.test');
    expect(chat?.lastMessage?.text).toBe('live one');
    expect(chat?.unread).toBe(1);
    expect(store.getState().messages('ana@galena.test').at(-1)?.id).toBe('ana-3');
    // The chat with the newest message moves to the top.
    expect(store.getState().chats[0]?.id).toBe('ana@galena.test');
  });

  it('clears unread and sends a displayed marker when a chat is opened', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit(
      'message',
      message({
        id: 'ana-3',
        chatJid: 'ana@galena.test',
        body: 'unread',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );
    expect(store.getState().chats.find((chat) => chat.id === 'ana@galena.test')?.unread).toBe(1);

    store.getState().openChat('ana@galena.test');
    await flush();

    expect(store.getState().chats.find((chat) => chat.id === 'ana@galena.test')?.unread).toBe(0);
    expect(xmpp.core.markDisplayed).toHaveBeenCalledWith(
      'ana@galena.test',
      'chat',
      expect.any(String),
    );
  });

  it('adds a sent message optimistically and confirms it without duplicating the echo', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@galena.test', 'hello there');
    const optimist = store.getState().messages('ana@galena.test').at(-1);
    expect(optimist?.text).toBe('hello there');
    expect(optimist?.status).toBe('sending');

    await flush();
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((item) => item.text === 'hello there')?.status,
    ).toBe('sent');

    xmpp.emit(
      'message',
      message({
        id: 'srv-1',
        chatJid: 'ana@galena.test',
        body: 'hello there',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    const matches = store
      .getState()
      .messages('ana@galena.test')
      .filter((item) => item.text === 'hello there');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('srv-1');
  });

  it('paginates older messages on demand', async () => {
    const history = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `ana-${index}`,
        chatJid: 'ana@galena.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = history;

    store.getState().openChat('ana@galena.test');
    await flush();

    expect(store.getState().messages('ana@galena.test')).toHaveLength(50);
    expect(store.getState().hasMore('ana@galena.test')).toBe(true);

    store.getState().loadOlder('ana@galena.test');
    await flush();

    expect(store.getState().messages('ana@galena.test')).toHaveLength(60);
    expect(store.getState().messages('ana@galena.test')[0]?.id).toBe('ana-0');
    expect(store.getState().hasMore('ana@galena.test')).toBe(false);
  });

  it('reflects connection status changes', async () => {
    const { store, xmpp } = await setup();
    expect(store.getState().status).toBe('online');

    xmpp.emit('status', 'reconnecting');
    expect(store.getState().status).toBe('reconnecting');

    xmpp.emit('status', 'online');
    expect(store.getState().status).toBe('online');
  });

  it('fetches a fresh XMPP token after the first one is used', async () => {
    const { api, xmpp } = await setup();
    expect(api.getXmppToken).toHaveBeenCalledTimes(1);

    const getToken = xmpp.options.current?.getToken;
    expect(getToken).toBeDefined();
    await getToken?.();
    expect(api.getXmppToken).toHaveBeenCalledTimes(1);
    await getToken?.();
    expect(api.getXmppToken).toHaveBeenCalledTimes(2);
  });

  it('creates a group, joins the room and returns its chat JID', async () => {
    const api = fakeApi({
      getChats: vi.fn(async () => {
        const groups = [
          {
            kind: 'group' as const,
            chatJid: 'new@rooms.galena.test',
            title: 'New',
            groupId: 'g2',
            memberCount: 2,
            role: 'owner' as const,
          },
        ];
        return groups;
      }),
    });
    const xmpp = fakeXmpp();
    const store = createRealChatStore({
      api,
      storage: memoryStorage(),
      createXmpp: (options) => {
        xmpp.options.current = options;
        return xmpp.core;
      },
    });
    store.getState().start();
    await flush();

    const chatJid = await store.getState().createGroup('New', ['u-ana']);
    expect(chatJid).toBe('new@rooms.galena.test');
    expect(api.createGroup).toHaveBeenCalledWith({ title: 'New', memberIds: ['u-ana'] });
    expect(xmpp.core.joinRoom).toHaveBeenCalledWith('new@rooms.galena.test', 'Me');
  });

  it('updates presence for a DM contact', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit('presence', { jid: 'ana@galena.test', available: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@galena.test')?.online).toBe(true);
    xmpp.emit('presence', { jid: 'ana@galena.test', available: false });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@galena.test')?.online).toBe(
      false,
    );
  });

  it('returns the invite URL', async () => {
    const { store } = await setup();
    await expect(store.getState().createInvite()).resolves.toBe('http://x/invite/c');
  });
});
