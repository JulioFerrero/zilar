import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@galena/xmpp-core';
import {
  createRealChatStore,
  type ApiClient,
  type RealStoreDeps,
  type StorageLike,
} from './realStore';

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
    occupants: vi.fn((): Occupant[] => []),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    requestUploadSlot: vi.fn(async () => ({
      putUrl: 'http://upload.galena.test/put/1',
      getUrl: 'http://upload.galena.test/get/1/voice.m4a',
      headers: {},
    })),
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
    getGroup: vi.fn(async () => ({ id: 'g1', title: 'Team', createdBy: 'u-me', members: [] })),
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

// The store debounces chat-list refreshes by 500 ms.
async function waitForRefresh(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  await flush();
}

async function setup(overrides: Partial<ApiClient> = {}, voice?: RealStoreDeps['voice']) {
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
    ...(voice === undefined ? {} : { voice }),
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

  it('sends a voice message with the server duration and the uploaded url', async () => {
    const voice = {
      convert: vi.fn(async () => ({
        audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
        durationMs: 4321,
      })),
      upload: vi.fn(async () => 'http://upload.galena.test/get/1/voice.m4a'),
    };
    const { store, xmpp } = await setup({}, voice);

    store.getState().sendVoice('ana@galena.test', {
      blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }),
      // The client's own duration must not reach the payload.
      durationMs: 9999,
      waveform: [1, 2, 3],
    });

    const optimistic = store.getState().messages('ana@galena.test').at(-1);
    expect(optimistic?.voice?.duration_ms).toBe(9999);
    expect(optimistic?.status).toBe('sending');

    await flush();

    expect(voice.convert).toHaveBeenCalledTimes(1);
    expect(voice.upload).toHaveBeenCalledTimes(1);
    expect(xmpp.core.sendMessage).toHaveBeenCalledWith('ana@galena.test', 'chat', '', {
      payload: {
        v: 0,
        type: 'voice',
        data: {
          duration_ms: 4321,
          mime: 'audio/mp4',
          waveform: [1, 2, 3],
          url: 'http://upload.galena.test/get/1/voice.m4a',
        },
      },
    });
    const sent = store.getState().messages('ana@galena.test').at(-1);
    expect(sent?.voice?.duration_ms).toBe(4321);
    expect(sent?.voice?.url).toBe('http://upload.galena.test/get/1/voice.m4a');
    expect(sent?.status).toBe('sent');
  });

  it('updates the list preview when the optimistic send is confirmed', async () => {
    const { store } = await setup();

    store.getState().sendText('ana@galena.test', 'hello there');
    await flush();

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@galena.test');
    const bubble = store.getState().messages('ana@galena.test').at(-1);
    expect(chat?.lastMessage?.status).toBe('sent');
    expect(bubble?.status).toBe('sent');
  });

  it('marks the bubble and the list read when a displayed marker arrives', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@galena.test', 'read me');
    await flush();
    // `sendMessage` resolves with the id the server echoes back.
    xmpp.emit('displayed', {
      chatJid: 'ana@galena.test',
      fromJid: 'ana@galena.test',
      messageId: 'srv-1',
    });

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@galena.test');
    const bubble = store.getState().messages('ana@galena.test').at(-1);
    expect(chat?.lastMessage?.status).toBe('read');
    expect(bubble?.status).toBe('read');
  });

  it('keeps the bubble and the list in agreement through sending and reading', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@galena.test', 'agree');
    const sending = store.getState().messages('ana@galena.test').at(-1);
    expect(sending?.status).toBe('sending');
    expect(
      store.getState().chats.find((entry) => entry.id === 'ana@galena.test')?.lastMessage?.status,
    ).toBe('sending');

    await flush();
    expect(
      store.getState().chats.find((entry) => entry.id === 'ana@galena.test')?.lastMessage?.status,
    ).toBe('sent');

    xmpp.emit('displayed', {
      chatJid: 'ana@galena.test',
      fromJid: 'ana@galena.test',
      messageId: 'srv-1',
    });
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((item) => item.text === 'agree')?.status,
    ).toBe('read');
    expect(
      store.getState().chats.find((entry) => entry.id === 'ana@galena.test')?.lastMessage?.status,
    ).toBe('read');
  });

  it('keeps a message read when the server echo arrives after a displayed marker', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@galena.test', 'late echo');
    await flush();
    xmpp.emit('displayed', {
      chatJid: 'ana@galena.test',
      fromJid: 'ana@galena.test',
      messageId: 'srv-1',
    });
    xmpp.emit(
      'message',
      message({
        id: 'srv-1',
        chatJid: 'ana@galena.test',
        body: 'late echo',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@galena.test');
    const bubble = store
      .getState()
      .messages('ana@galena.test')
      .find((item) => item.text === 'late echo');
    expect(bubble?.status).toBe('read');
    expect(chat?.lastMessage?.status).toBe('read');
  });

  it('ignores my own typing reflected from a group', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'me@galena.test',
      state: 'composing',
    });
    expect(store.getState().typing['team@rooms.galena.test']).toBeUndefined();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'ana@galena.test',
      state: 'composing',
    });
    expect(store.getState().typing['team@rooms.galena.test']?.names).toEqual(['Ana']);
  });

  it('ignores my own displayed marker reflected from a group', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('team@rooms.galena.test', 'mine');
    await flush();

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'me@galena.test',
      messageId: 'srv-1',
    });
    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.status).toBe('sent');
    expect(
      store.getState().chats.find((entry) => entry.id === 'team@rooms.galena.test')?.lastMessage
        ?.status,
    ).toBe('sent');

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'ana@galena.test',
      messageId: 'srv-1',
    });
    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.status).toBe('read');
  });

  it('ignores an unresolved own typing reflection from a group', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'team@rooms.galena.test/mynick',
      state: 'composing',
      outgoing: true,
    });

    expect(store.getState().typing['team@rooms.galena.test']).toBeUndefined();
  });

  it('ignores an unresolved own displayed reflection from a group', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('team@rooms.galena.test', 'mine');
    await flush();

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'team@rooms.galena.test/mynick',
      messageId: 'srv-1',
      outgoing: true,
    });

    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.status).toBe('sent');
    expect(
      store.getState().chats.find((entry) => entry.id === 'team@rooms.galena.test')?.lastMessage
        ?.status,
    ).toBe('sent');
  });

  it('shows a group member name for typing when they are not a contact', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-luis', name: 'Luis', role: 'member' as const }],
    }));
    const { store, xmpp } = await setup({ getGroup });
    await flush();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'u-luis@galena.test',
      state: 'composing',
    });

    expect(store.getState().typing['team@rooms.galena.test']?.names).toEqual(['Luis']);
  });

  it('shows Someone instead of a JID localpart for an unknown group sender', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'z9y8x7@galena.test',
      state: 'composing',
    });

    expect(store.getState().typing['team@rooms.galena.test']?.names).toEqual(['Someone']);
  });

  it('uses the occupant nick when a group sender is not a known member', async () => {
    const { store, xmpp } = await setup();
    vi.mocked(xmpp.core.occupants).mockReturnValue([
      {
        jid: 'team@rooms.galena.test/pablo',
        nick: 'Pablo',
        available: true,
        realJid: 'pablo@galena.test',
      },
    ]);

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'pablo@galena.test',
      state: 'composing',
    });

    expect(store.getState().typing['team@rooms.galena.test']?.names).toEqual(['Pablo']);
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

  it('refreshes the chat list on an invitation and joins the new group room', async () => {
    const base = [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
    ];
    const invited = {
      kind: 'group' as const,
      chatJid: 'new@rooms.galena.test',
      title: 'New',
      groupId: 'g2',
      memberCount: 2,
      role: 'member' as const,
    };
    let calls = 0;
    const getChats = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? base : [...base, invited];
    });
    const { store, xmpp } = await setup({ getChats });

    xmpp.emit('invited', {
      roomJid: 'new@rooms.galena.test',
      fromJid: 'ana@galena.test',
      reason: 'Join us',
    });
    await waitForRefresh();

    expect(store.getState().chats[0]?.id).toBe('new@rooms.galena.test');
    expect(xmpp.core.joinRoom).toHaveBeenCalledWith('new@rooms.galena.test', 'Me');
    expect(xmpp.core.loadHistory).toHaveBeenCalledWith('new@rooms.galena.test', 'groupchat', {
      max: 1,
    });
  });

  it('refreshes the chat list on a roster push', async () => {
    const base = [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
    ];
    const added = [
      ...base,
      { kind: 'dm' as const, chatJid: 'carla@galena.test', title: 'Carla', userId: 'u-carla' },
    ];
    let calls = 0;
    const getChats = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? base : added;
    });
    const { store, xmpp } = await setup({ getChats });

    xmpp.emit('roster', { jid: 'carla@galena.test', subscription: 'both', name: 'Carla' });
    await waitForRefresh();

    expect(store.getState().chats[0]?.id).toBe('carla@galena.test');
  });

  it('debounces repeated refresh events into a single refetch', async () => {
    const base = [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
    ];
    const getChats = vi.fn(async () => base);
    const { xmpp } = await setup({ getChats });
    getChats.mockClear();

    xmpp.emit('invited', { roomJid: 'new@rooms.galena.test' });
    xmpp.emit('roster', { jid: 'carla@galena.test', subscription: 'both' });
    xmpp.emit('invited', { roomJid: 'other@rooms.galena.test' });
    await waitForRefresh();

    expect(getChats).toHaveBeenCalledTimes(1);
  });
});

describe('loading states (T-0042)', () => {
  async function waitForState(check: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (check()) {
        return;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('timed out waiting for store state');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function pageLoads(xmpp: FakeXmpp, chatJid: string): number {
    return vi
      .mocked(xmpp.core.loadHistory)
      .mock.calls.filter(([jid, , options]) => jid === chatJid && options?.max === 50).length;
  }

  function unstartedStore(overrides: Partial<ApiClient> = {}): {
    store: ReturnType<typeof createRealChatStore>;
    api: ApiClient;
    xmpp: FakeXmpp;
  } {
    const api = fakeApi(overrides);
    const xmpp = fakeXmpp();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'hello before ready',
        timestamp: new Date('2026-09-28T09:00:00Z'),
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
      createXmpp: () => xmpp.core,
    });
    return { store, api, xmpp };
  }

  it('exposes chatsState loading before boot and ready after', async () => {
    const { store } = unstartedStore();
    expect(store.getState().chatsState).toBe('loading');

    store.getState().start();
    await waitForState(() => store.getState().chatsState === 'ready');

    expect(store.getState().chats.map((chat) => chat.id)).toContain('ana@galena.test');
  });

  it('goes loading -> error -> retry -> ready when /api/chats fails first', async () => {
    const chats = [
      { kind: 'dm' as const, chatJid: 'ana@galena.test', title: 'Ana', userId: 'u-ana' },
    ];
    const getChats = vi
      .fn()
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue(chats);
    const { store } = unstartedStore({ getChats });
    expect(store.getState().chatsState).toBe('loading');

    store.getState().start();
    await waitForState(() => store.getState().chatsState === 'error');

    store.getState().retryChats();
    await waitForState(() => store.getState().chatsState === 'ready');
    expect(store.getState().chats.map((chat) => chat.id)).toEqual(['ana@galena.test']);
  });

  it('loads history for a chat opened before the core and chats are ready', async () => {
    const { store, xmpp } = unstartedStore();

    store.getState().openChat('ana@galena.test');
    store.getState().start();
    await waitForState(() => store.getState().messages('ana@galena.test').length > 0);

    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .map((item) => item.text),
    ).toContain('hello before ready');
    expect(pageLoads(xmpp, 'ana@galena.test')).toBe(1);
  });

  it('waits for the connection to be online before loading history', async () => {
    // Julio's reload bug: `core` exists while `connect()` is still in flight,
    // and a MAM query sent then fails with "Couldn't load messages".
    const { store, xmpp } = unstartedStore();
    let finishConnect: () => void = () => {};
    vi.mocked(xmpp.core.connect).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishConnect = resolve;
        }),
    );

    store.getState().start();
    await waitForState(() => store.getState().chatsState === 'ready');
    store.getState().openChat('ana@galena.test');
    await flush();
    expect(pageLoads(xmpp, 'ana@galena.test')).toBe(0);
    expect(store.getState().historyState['ana@galena.test']).toBe('loading');

    finishConnect();
    await waitForState(() => store.getState().historyState['ana@galena.test'] === 'ready');
    expect(pageLoads(xmpp, 'ana@galena.test')).toBe(1);
  });

  it('only the latest pending chat loads', async () => {
    const { store, xmpp } = unstartedStore();

    store.getState().openChat('ana@galena.test');
    store.getState().openChat('team@rooms.galena.test');
    store.getState().start();
    await waitForState(() => store.getState().messages('team@rooms.galena.test').length > 0);
    await flush();

    expect(pageLoads(xmpp, 'team@rooms.galena.test')).toBe(1);
    expect(pageLoads(xmpp, 'ana@galena.test')).toBe(0);
  });

  it('does not load the same chat history twice', async () => {
    const { store, xmpp } = await setup();

    store.getState().openChat('ana@galena.test');
    store.getState().openChat('ana@galena.test');
    await waitForState(() => store.getState().messages('ana@galena.test').length > 0);
    await flush();

    expect(pageLoads(xmpp, 'ana@galena.test')).toBe(1);
  });

  it('marks per-chat history loading, then ready', async () => {
    const { store } = unstartedStore();

    store.getState().openChat('ana@galena.test');
    expect(store.getState().historyState['ana@galena.test']).toBe('loading');

    store.getState().start();
    await waitForState(() => store.getState().historyState['ana@galena.test'] === 'ready');
  });

  it('marks per-chat history error when the page load fails', async () => {
    const { store, xmpp } = await setup();
    vi.mocked(xmpp.core.loadHistory).mockRejectedValueOnce(new Error('mam failed'));

    store.getState().openChat('ana@galena.test');
    await waitForState(() => store.getState().historyState['ana@galena.test'] === 'error');
  });

  it('clears the loading marker of a superseded pending chat', async () => {
    const { store, xmpp } = unstartedStore();

    store.getState().openChat('ana@galena.test');
    expect(store.getState().historyState['ana@galena.test']).toBe('loading');

    store.getState().openChat('team@rooms.galena.test');
    expect(store.getState().historyState['ana@galena.test']).toBeUndefined();
    expect(store.getState().historyState['team@rooms.galena.test']).toBe('loading');

    store.getState().start();
    await waitForState(() => store.getState().messages('team@rooms.galena.test').length > 0);
    expect(pageLoads(xmpp, 'team@rooms.galena.test')).toBe(1);
    expect(pageLoads(xmpp, 'ana@galena.test')).toBe(0);
  });
});
