import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@galena/xmpp-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { MessageBubble } from '@/components/MessageBubble';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import type { DraftHubEvent } from '@/lib/drafts';
import { AttachmentError, type AttachmentPort } from '@/lib/attachments';
import {
  CONNECT_RETRY_DELAYS_MS,
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  createRealChatStore,
  type ApiClient,
  type RealStoreDeps,
  type StorageLike,
} from './realStore';

// Sign-out must not hit Better Auth over the network in a test.
vi.mock('@/lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => ({})) },
}));

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

function reactionMessage(overrides: {
  id: string;
  chatJid: string;
  targetId: string;
  emojis: string[];
  timestamp: Date;
  fromJid?: string;
  fromNick?: string;
  outgoing?: boolean;
}): ChatMessage {
  const result: ChatMessage = {
    id: overrides.id,
    chatJid: overrides.chatJid,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: overrides.fromJid ?? 'ana@galena.test',
    fromResolved: true,
    timestamp: overrides.timestamp,
    outgoing: overrides.outgoing ?? false,
    reactions: { targetId: overrides.targetId, emojis: overrides.emojis },
  };
  if (overrides.fromNick !== undefined) result.fromNick = overrides.fromNick;
  return result;
}

function correctionMessage(overrides: {
  id: string;
  chatJid: string;
  targetId: string;
  text: string;
  timestamp: Date;
  fromJid?: string;
  fromNick?: string;
  occupantId?: string;
  fromResolved?: boolean;
  outgoing?: boolean;
}): ChatMessage {
  const result: ChatMessage = {
    id: overrides.id,
    chatJid: overrides.chatJid,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: overrides.fromJid ?? 'ana@galena.test',
    fromResolved: overrides.fromResolved ?? true,
    timestamp: overrides.timestamp,
    outgoing: overrides.outgoing ?? false,
    body: overrides.text,
    correction: { targetId: overrides.targetId },
  };
  if (overrides.fromNick !== undefined) result.fromNick = overrides.fromNick;
  if (overrides.occupantId !== undefined) result.occupantId = overrides.occupantId;
  return result;
}

function retractionMessage(overrides: {
  id: string;
  chatJid: string;
  targetId: string;
  timestamp: Date;
  fromJid?: string;
  fromNick?: string;
  occupantId?: string;
  fromResolved?: boolean;
  outgoing?: boolean;
}): ChatMessage {
  const result: ChatMessage = {
    id: overrides.id,
    chatJid: overrides.chatJid,
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: overrides.fromJid ?? 'ana@galena.test',
    fromResolved: overrides.fromResolved ?? true,
    timestamp: overrides.timestamp,
    outgoing: overrides.outgoing ?? false,
    retraction: { targetId: overrides.targetId },
  };
  if (overrides.fromNick !== undefined) result.fromNick = overrides.fromNick;
  if (overrides.occupantId !== undefined) result.occupantId = overrides.occupantId;
  return result;
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
    sendReactions: vi.fn(async () => {}),
    sendCorrection: vi.fn(async () => ({ id: 'edit-1' })),
    sendRetraction: vi.fn(async () => {}),
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
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
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
      ais: [],
    })),
    createInvite: vi.fn(async () => ({ code: 'c', url: 'http://x/invite/c' })),
    listAis: vi.fn(async () => []),
    addGroupAi: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    removeGroupAi: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    createTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    getTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    patchTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    archiveTopic: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listGroupTopics: vi.fn(async () => []),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    removeTopicMember: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    removeTopicAi: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    setMembersCanCreateTopics: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
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

async function setup(
  overrides: Partial<ApiClient> = {},
  voice?: RealStoreDeps['voice'],
  deps: Partial<RealStoreDeps> = {},
) {
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
    ...deps,
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
      ais: [],
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

  it('maps a received mention to the member name', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-ana', name: 'Ana', role: 'member' as const }],
      ais: [],
    }));
    const { store, xmpp } = await setup({ getGroup });
    await flush();

    xmpp.emit(
      'message',
      message({
        id: 'team-2',
        chatJid: 'team@rooms.galena.test',
        body: 'hi @Ana',
        fromJid: 'u-ana@galena.test',
        mentions: [{ jid: 'u-ana@galena.test', begin: 3, end: 7 }],
      }),
    );

    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.mentions).toEqual([
      { jid: 'u-ana@galena.test', name: 'Ana', begin: 3, end: 7 },
    ]);
  });

  it('falls back to the text at the range for an unknown mention', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'team-3',
        chatJid: 'team@rooms.galena.test',
        body: 'hi @Zed',
        fromJid: 'u-zed@galena.test',
        mentions: [{ jid: 'zed@galena.test', begin: 3, end: 7 }],
      }),
    );

    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.mentions).toEqual([
      { jid: 'zed@galena.test', name: '@Zed', begin: 3, end: 7 },
    ]);
  });

  it('ignores a mention without usable offsets', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'team-4',
        chatJid: 'team@rooms.galena.test',
        body: 'hi @Ana',
        fromJid: 'u-ana@galena.test',
        mentions: [{ jid: 'u-ana@galena.test' }],
      }),
    );

    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.mentions).toBeUndefined();
  });

  it('exposes the group members with their JIDs', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [
        { userId: 'u-me', name: 'Me', role: 'owner' as const },
        { userId: 'u-ana', name: 'Ana', role: 'member' as const },
      ],
      ais: [],
    }));
    const { store } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    expect(store.getState().groupMembers('team@rooms.galena.test')).toEqual([
      { jid: 'u-me@galena.test', name: 'Me' },
      { jid: 'u-ana@galena.test', name: 'Ana' },
    ]);
  });

  it('includes the group AIs in groupMembers', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@galena.test', name: 'Dev-1', ownerId: 'u-me' }],
    }));
    const { store } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    expect(store.getState().groupMembers('team@rooms.galena.test')).toEqual([
      { jid: 'u-me@galena.test', name: 'Me' },
      { jid: 'ai-dev-1@galena.test', name: 'Dev-1' },
    ]);
    expect(store.getState().groupInfo('team@rooms.galena.test')?.ais).toEqual([
      { aiId: 'dev-1', jid: 'ai-dev-1@galena.test', name: 'Dev-1', ownerId: 'u-me' },
    ]);
  });

  it('adds an AI through the API and refreshes the members', async () => {
    const before = {
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [],
    };
    const after = {
      ...before,
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@galena.test', name: 'Dev-1', ownerId: 'u-me' }],
    };
    const getGroup = vi.fn(async () => before);
    const addGroupAi = vi.fn(async () => after);
    const { store } = await setup({ getGroup, addGroupAi });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    await store.getState().addGroupAi('team@rooms.galena.test', 'dev-1');

    expect(addGroupAi).toHaveBeenCalledWith('g1', 'dev-1');
    expect(store.getState().groupMembers('team@rooms.galena.test')).toContainEqual({
      jid: 'ai-dev-1@galena.test',
      name: 'Dev-1',
    });
    expect(store.getState().groupInfo('team@rooms.galena.test')?.ais).toHaveLength(1);
  });

  it('removes an AI through the API and refreshes the members', async () => {
    const before = {
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@galena.test', name: 'Dev-1', ownerId: 'u-me' }],
    };
    const after = { ...before, ais: [] };
    const getGroup = vi.fn(async () => before);
    const removeGroupAi = vi.fn(async () => after);
    const { store } = await setup({ getGroup, removeGroupAi });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    await store.getState().removeGroupAi('team@rooms.galena.test', 'dev-1');

    expect(removeGroupAi).toHaveBeenCalledWith('g1', 'dev-1');
    expect(store.getState().groupMembers('team@rooms.galena.test')).toEqual([
      { jid: 'u-me@galena.test', name: 'Me' },
    ]);
  });

  it('names a group AI message from the group AIs and renders it as AI Markdown', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@galena.test', name: 'Dev-1', ownerId: 'u-me' }],
    }));
    const { store, xmpp } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    xmpp.emit(
      'message',
      message({
        id: 'ai-msg-1',
        chatJid: 'team@rooms.galena.test',
        body: '**done**',
        fromJid: 'ai-dev-1@galena.test',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    const last = store.getState().messages('team@rooms.galena.test').at(-1);
    const chat = store.getState().chats.find((entry) => entry.id === 'team@rooms.galena.test');
    expect(last?.senderName).toBe('Dev-1');
    if (last === undefined || chat === undefined) {
      throw new Error('the group AI message was not stored');
    }

    const { container } = render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-me', name: 'Me', email: 'me@galena.test' },
          refetch: async () => {},
        }}
      >
        <ChatStoreProvider store={store}>
          <MessageBubble
            message={last}
            chat={chat}
            firstInGroup
            lastInGroup
            currentUserId="u-me"
            onReply={() => {}}
          />
        </ChatStoreProvider>
      </AuthProvider>,
    );

    expect(screen.getByText('Dev-1')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(container.querySelector('strong')?.textContent).toBe('done');
  });

  it('passes outgoing mentions to the core', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('team@rooms.galena.test', 'hi @Ana', {
      mentions: [{ jid: 'u-ana@galena.test', name: 'Ana', begin: 3, end: 7 }],
    });

    expect(xmpp.core.sendMessage).toHaveBeenCalledWith(
      'team@rooms.galena.test',
      'groupchat',
      'hi @Ana',
      { mentions: [{ jid: 'u-ana@galena.test', begin: 3, end: 7 }] },
    );
    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.mentions).toEqual([
      { jid: 'u-ana@galena.test', name: 'Ana', begin: 3, end: 7 },
    ]);
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

  it('opens a chat at a loaded message without paging', async () => {
    const { store } = await setup();
    const found = await store.getState().openAtMessage('ana@galena.test', 'ana-2');
    expect(found.id).toBe('ana-2');
    expect(store.getState().activeChatId).toBe('ana@galena.test');
  });

  it('pages backwards until a far-back message is loaded', async () => {
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

    const found = await store.getState().openAtMessage('ana@galena.test', 'ana-3');
    expect(found.text).toBe('msg 3');
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .some((item) => item.id === 'ana-3'),
    ).toBe(true);
  });

  it('rejects message_not_found when history runs out', async () => {
    const { store } = await setup();
    await expect(store.getState().openAtMessage('ana@galena.test', 'ghost')).rejects.toThrow(
      'message_not_found',
    );
  });

  it('gives up with message_not_found when a history fetch stalls', async () => {
    const { store, xmpp } = await setup();
    vi.useFakeTimers();
    try {
      // The opening page never settles: openAtMessage must not hang forever.
      vi.mocked(xmpp.core.loadHistory).mockImplementationOnce(() => new Promise(() => {}));
      const pending = store.getState().openAtMessage('ana@galena.test', 'ana-2');
      // Attach the assertion before the timers fire, so the rejection never
      // sits unhandled while the fake clock advances.
      const rejected = expect(pending).rejects.toThrow('message_not_found');
      await vi.advanceTimersByTimeAsync(11_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
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

  it('toggles my reaction, sends the set and shows the chip', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();

    store.getState().react('ana@galena.test', 'ana-1', '👍');
    await flush();

    expect(xmpp.core.sendReactions).toHaveBeenCalledWith('ana@galena.test', 'chat', 'ana-1', [
      '👍',
    ]);
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toEqual([{ emoji: '👍', count: 1, mine: true, reactors: ['You'] }]);

    store.getState().react('ana@galena.test', 'ana-1', '👍');
    await flush();

    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith(
      'ana@galena.test',
      'chat',
      'ana-1',
      [],
    );
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toBeUndefined();
  });

  it('reverts my optimistic reaction when the send fails', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();

    vi.mocked(xmpp.core.sendReactions).mockRejectedValueOnce(new Error('offline'));
    store.getState().react('ana@galena.test', 'ana-1', '👍');
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toEqual([{ emoji: '👍', count: 1, mine: true, reactors: ['You'] }]);

    await flush();
    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toBeUndefined();
  });

  it('applies history reactions before and after the target message', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      reactionMessage({
        id: 'r-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        emojis: ['👍'],
        timestamp: new Date('2026-09-28T09:01:00Z'),
      }),
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      reactionMessage({
        id: 'r-2',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        emojis: ['👍', '❤️'],
        timestamp: new Date('2026-09-28T09:02:00Z'),
      }),
    ];

    store.getState().openChat('ana@galena.test');
    await flush();

    const list = store.getState().messages('ana@galena.test');
    expect(list.map((m) => m.id)).toEqual(['ana-1']);
    expect(list[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, reactors: ['Ana'] },
      { emoji: '❤️', count: 1, mine: false, reactors: ['Ana'] },
    ]);
  });

  it('applies a live reaction message without adding a bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();
    const before = store.getState().messages('ana@galena.test').length;

    xmpp.emit(
      'message',
      reactionMessage({
        id: 'r-live',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        emojis: ['❤️'],
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const list = store.getState().messages('ana@galena.test');
    expect(list).toHaveLength(before);
    expect(list.find((m) => m.id === 'ana-1')?.reactions).toEqual([
      { emoji: '❤️', count: 1, mine: false, reactors: ['Ana'] },
    ]);
    expect(store.getState().chats.find((c) => c.id === 'ana@galena.test')?.lastMessage?.id).toBe(
      'ana-2',
    );
  });

  it('renders a message that carries both a body and reactions', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();
    const before = store.getState().messages('ana@galena.test').length;

    xmpp.emit(
      'message',
      message({
        id: 'ana-3',
        chatJid: 'ana@galena.test',
        body: 'text plus a reaction',
        timestamp: new Date('2026-09-28T12:07:00Z'),
        reactions: { targetId: 'ana-1', emojis: ['🎉'] },
      }),
    );

    const list = store.getState().messages('ana@galena.test');
    expect(list).toHaveLength(before + 1);
    expect(list.find((m) => m.id === 'ana-3')?.text).toBe('text plus a reaction');
    expect(list.find((m) => m.id === 'ana-1')?.reactions).toEqual([
      { emoji: '🎉', count: 1, mine: false, reactors: ['Ana'] },
    ]);
  });

  it('keeps a reaction for a message that is not loaded yet and shows it later', async () => {
    const history: ChatMessage[] = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `ana-${index}`,
        chatJid: 'ana@galena.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    history.push(
      reactionMessage({
        id: 'r-old',
        chatJid: 'ana@galena.test',
        targetId: 'ana-0',
        emojis: ['👍'],
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, 40)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = history;

    store.getState().openChat('ana@galena.test');
    await flush();
    expect(store.getState().messages('ana@galena.test')[0]?.id).toBe('ana-11');

    store.getState().loadOlder('ana@galena.test');
    await flush();

    const first = store.getState().messages('ana@galena.test')[0];
    expect(first?.id).toBe('ana-0');
    expect(first?.reactions).toEqual([{ emoji: '👍', count: 1, mine: false, reactors: ['Ana'] }]);
  });

  it('targets group reactions by stanza-id and names the group member', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'ana', name: 'Ana', role: 'member' as const }],
      ais: [],
    }));
    const { store, xmpp } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    xmpp.emit(
      'message',
      reactionMessage({
        id: 'r-g',
        chatJid: 'team@rooms.galena.test',
        targetId: 'team-1',
        emojis: ['👍'],
        fromJid: 'ana@galena.test',
        fromNick: 'ana',
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    expect(store.getState().messages('team@rooms.galena.test')[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, reactors: ['Ana'] },
    ]);

    store.getState().react('team@rooms.galena.test', 'team-1', '❤️');
    expect(xmpp.core.sendReactions).toHaveBeenCalledWith(
      'team@rooms.galena.test',
      'groupchat',
      'team-1',
      ['❤️'],
    );
  });

  it('matches a reaction to my optimistic message through the id alias', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();

    store.getState().sendText('ana@galena.test', 'hello');
    await flush();
    const local = store.getState().messages('ana@galena.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic message was not stored');
    }
    expect(local).toBe('local-1');

    store.getState().react('ana@galena.test', local, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenCalledWith('ana@galena.test', 'chat', 'srv-1', [
      '👍',
    ]);

    xmpp.emit(
      'message',
      message({
        id: 'srv-1',
        chatJid: 'ana@galena.test',
        body: 'hello',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:06:00Z'),
      }),
    );
    await flush();

    const echoed = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'srv-1');
    expect(echoed?.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, reactors: ['You'] }]);
  });

  it('does not react to a message whose server id is not known yet', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();

    // The send never resolves, so the optimistic message keeps its local id
    // and has no server id to name: reacting must change nothing.
    vi.mocked(xmpp.core.sendMessage).mockImplementationOnce(
      () => new Promise<{ id: string }>(() => {}),
    );
    store.getState().sendText('ana@galena.test', 'still sending');
    const local = store.getState().messages('ana@galena.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic message was not stored');
    }
    expect(local.startsWith('local-')).toBe(true);

    store.getState().react('ana@galena.test', local, '👍');

    expect(xmpp.core.sendReactions).not.toHaveBeenCalled();
    expect(store.getState().messages('ana@galena.test').at(-1)?.reactions).toBeUndefined();
  });
});

describe('message edits and deletes (T-0061)', () => {
  it('edits my own message optimistically, sends the origin id and shows the new text', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();

    store.getState().sendText('ana@galena.test', 'hello');
    await flush();
    const local = store.getState().messages('ana@galena.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic message was not stored');
    }

    store.getState().editMessage('ana@galena.test', local, 'hello there');

    // A correction names the original by its sender-generated id (srv-1 is what
    // sendMessage returned; xmpp-core's origin id).
    expect(xmpp.core.sendCorrection).toHaveBeenCalledWith(
      'ana@galena.test',
      'chat',
      'srv-1',
      'hello there',
      undefined,
    );
    const edited = store.getState().messages('ana@galena.test').at(-1);
    expect(edited?.text).toBe('hello there');
    expect(edited?.edited).toBe(true);
  });

  it('reverts an optimistic edit when the send fails', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        fromJid: 'me@galena.test',
        outgoing: true,
        originId: 'origin-older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
    ];
    store.getState().openChat('ana@galena.test');
    await flush();

    vi.mocked(xmpp.core.sendCorrection).mockRejectedValueOnce(new Error('offline'));
    store.getState().editMessage('ana@galena.test', 'ana-1', 'changed');
    expect(store.getState().messages('ana@galena.test')[0]?.text).toBe('changed');

    await flush();
    const reverted = store.getState().messages('ana@galena.test')[0];
    expect(reverted?.text).toBe('older');
    expect(reverted?.edited).toBeUndefined();
    expect(store.getState().actionError?.message).toContain('Could not save the edit');
  });

  it('deletes for everyone in a DM by the origin id and shows a tombstone', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        fromJid: 'me@galena.test',
        outgoing: true,
        originId: 'origin-older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
        reactions: { targetId: 'ana-1', emojis: ['👍'] },
      }),
      message({
        id: 'ana-2',
        chatJid: 'ana@galena.test',
        body: 'newest',
        timestamp: new Date('2026-09-28T10:00:00Z'),
      }),
    ];
    store.getState().openChat('ana@galena.test');
    await flush();

    store.getState().deleteForEveryone('ana@galena.test', 'ana-1');
    expect(xmpp.core.sendRetraction).toHaveBeenCalledWith(
      'ana@galena.test',
      'chat',
      'origin-older',
    );
    const deleted = store.getState().messages('ana@galena.test')[0];
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.text).toBeUndefined();
    expect(deleted?.reactions).toBeUndefined();
  });

  it('reverts an optimistic delete, restoring text and reactions', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        fromJid: 'me@galena.test',
        outgoing: true,
        originId: 'origin-older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
        reactions: { targetId: 'ana-1', emojis: ['👍'] },
      }),
    ];
    store.getState().openChat('ana@galena.test');
    await flush();

    vi.mocked(xmpp.core.sendRetraction).mockRejectedValueOnce(new Error('offline'));
    store.getState().deleteForEveryone('ana@galena.test', 'ana-1');
    expect(store.getState().messages('ana@galena.test')[0]?.deleted).toBe(true);

    await flush();
    const reverted = store.getState().messages('ana@galena.test')[0];
    expect(reverted?.deleted).toBeUndefined();
    expect(reverted?.text).toBe('older');
    expect(store.getState().actionError?.message).toContain('Could not delete');
  });

  it('applies a live correction without adding a bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();
    const before = store.getState().messages('ana@galena.test').length;

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        text: 'corrected live',
        fromJid: 'ana@galena.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const list = store.getState().messages('ana@galena.test');
    expect(list).toHaveLength(before);
    const target = list.find((m) => m.id === 'ana-1');
    expect(target?.text).toBe('corrected live');
    expect(target?.edited).toBe(true);
  });

  it('resolves a correction that names the origin id of a message stored under its stanza-id', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'stanza-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        fromJid: 'ana@galena.test',
        originId: 'origin-1',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
    ];
    store.getState().openChat('ana@galena.test');
    await flush();

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@galena.test',
        targetId: 'origin-1',
        text: 'matched by origin',
        fromJid: 'ana@galena.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const target = store.getState().messages('ana@galena.test')[0];
    expect(target?.id).toBe('stanza-1');
    expect(target?.text).toBe('matched by origin');
    expect(target?.edited).toBe(true);
  });

  it('applies a live retraction, stripping the message and leaving its place', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();
    const before = store.getState().messages('ana@galena.test').length;

    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        fromJid: 'ana@galena.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const list = store.getState().messages('ana@galena.test');
    expect(list).toHaveLength(before);
    const target = list.find((m) => m.id === 'ana-1');
    expect(target?.deleted).toBe(true);
    expect(target?.text).toBeUndefined();
  });

  it('ignores a correction or retraction from a foreign sender', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@galena.test');
    await flush();

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        text: 'hijacked',
        fromJid: 'luis@galena.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );
    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-2',
        fromJid: 'luis@galena.test',
        timestamp: new Date('2026-09-28T12:06:00Z'),
      }),
    );

    const list = store.getState().messages('ana@galena.test');
    expect(list.find((m) => m.id === 'ana-1')?.text).toBe('older');
    expect(list.find((m) => m.id === 'ana-2')?.deleted).toBeUndefined();
  });

  it('applies history edits before and after the target', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        text: 'corrected twice',
        fromJid: 'ana@galena.test',
        timestamp: new Date('2026-09-28T09:00:30Z'),
      }),
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-2',
        fromJid: 'ana@galena.test',
        timestamp: new Date('2026-09-28T10:00:30Z'),
      }),
      message({
        id: 'ana-2',
        chatJid: 'ana@galena.test',
        body: 'newest',
        timestamp: new Date('2026-09-28T10:00:00Z'),
      }),
    ];

    store.getState().openChat('ana@galena.test');
    await flush();

    const list = store.getState().messages('ana@galena.test');
    expect(list.map((m) => m.id)).toEqual(['ana-1', 'ana-2']);
    expect(list[0]?.text).toBe('corrected twice');
    expect(list[0]?.edited).toBe(true);
    expect(list[1]?.deleted).toBe(true);
    expect(list[1]?.text).toBeUndefined();
  });

  it('keeps a correction for a target that is not loaded yet and applies it later', async () => {
    const history: ChatMessage[] = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `ana-${index}`,
        chatJid: 'ana@galena.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    history.push(
      correctionMessage({
        id: 'c-old',
        chatJid: 'ana@galena.test',
        targetId: 'ana-0',
        text: 'fixed later',
        fromJid: 'ana@galena.test',
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, 40)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = history;

    store.getState().openChat('ana@galena.test');
    await flush();
    expect(store.getState().messages('ana@galena.test')[0]?.id).toBe('ana-11');

    store.getState().loadOlder('ana@galena.test');
    await flush();

    const first = store.getState().messages('ana@galena.test')[0];
    expect(first?.id).toBe('ana-0');
    expect(first?.text).toBe('fixed later');
    expect(first?.edited).toBe(true);
  });

  it('updates the preview and reply quotes for edits and deletes', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@galena.test',
        body: 'older',
        fromJid: 'me@galena.test',
        outgoing: true,
        originId: 'origin-1',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      message({
        id: 'ana-2',
        chatJid: 'ana@galena.test',
        body: 'reply to older',
        timestamp: new Date('2026-09-28T10:00:00Z'),
        replyTo: { id: 'ana-1' },
      }),
      message({
        id: 'ana-3',
        chatJid: 'ana@galena.test',
        body: 'reply to the reply',
        fromJid: 'me@galena.test',
        outgoing: true,
        originId: 'origin-3',
        timestamp: new Date('2026-09-28T11:00:00Z'),
        replyTo: { id: 'ana-2' },
      }),
    ];
    store.getState().openChat('ana@galena.test');
    await flush();

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-1',
        text: 'corrected preview',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:00:00Z'),
      }),
    );

    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((m) => m.id === 'ana-2')?.replyTo?.text,
    ).toBe('corrected preview');

    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@galena.test',
        targetId: 'ana-2',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    expect(
      store
        .getState()
        .messages('ana@galena.test')
        .find((m) => m.id === 'ana-3')?.replyTo?.text,
    ).toBe('Deleted message');

    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-2',
        chatJid: 'ana@galena.test',
        targetId: 'ana-3',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    expect(store.getState().chats.find((c) => c.id === 'ana@galena.test')?.lastMessage?.text).toBe(
      'Message deleted',
    );
  });

  it('targets a group delete by stanza-id and authorizes the sender by member name', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'ana', name: 'Ana', role: 'member' as const }],
      ais: [],
    }));
    const { store, xmpp } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.galena.test');
    await flush();

    store.getState().sendText('team@rooms.galena.test', 'hello room');
    await flush();

    const local = store.getState().messages('team@rooms.galena.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic group message was not stored');
    }

    // The MUC echo assigns the stanza-id that a group retraction must name.
    xmpp.emit(
      'message',
      message({
        id: 'sid-1',
        chatJid: 'team@rooms.galena.test',
        body: 'hello room',
        fromJid: 'me@galena.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:06:00Z'),
      }),
    );
    await flush();

    store.getState().deleteForEveryone('team@rooms.galena.test', local);
    expect(xmpp.core.sendRetraction).toHaveBeenCalledWith(
      'team@rooms.galena.test',
      'groupchat',
      'sid-1',
    );
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

  it('retries the connection after a failed token request instead of staying offline', async () => {
    // Julio hit the token route's 429 and the app stayed on "Waiting for
    // network…" until a reload.
    vi.useFakeTimers();
    try {
      const { store, api, xmpp } = unstartedStore();
      const original = api.getXmppToken.bind(api);
      let calls = 0;
      api.getXmppToken = async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('rate_limited');
        }
        return original();
      };

      store.getState().start();
      await vi.advanceTimersByTimeAsync(10);
      expect(store.getState().status).toBe('offline');
      expect(xmpp.core.connect).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_DELAYS_MS[0] ?? 0);
      expect(xmpp.core.connect).toHaveBeenCalledTimes(1);
      expect(store.getState().status).toBe('online');
    } finally {
      vi.useRealTimers();
    }
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

  it('loads a group history only after the room is joined', async () => {
    // Julio's reload bug on groups: MUC MAM before the join fails.
    const { store, xmpp } = unstartedStore();
    let finishJoin: () => void = () => {};
    vi.mocked(xmpp.core.joinRoom).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishJoin = resolve;
        }),
    );

    store.getState().openChat('team@rooms.galena.test');
    store.getState().start();
    await waitForState(() => store.getState().status === 'online');
    await flush();
    expect(pageLoads(xmpp, 'team@rooms.galena.test')).toBe(0);

    finishJoin();
    await waitForState(() => store.getState().historyState['team@rooms.galena.test'] === 'ready');
    expect(pageLoads(xmpp, 'team@rooms.galena.test')).toBe(1);
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

describe('AI reply drafts (T-0043)', () => {
  const CHAT = 'ana@galena.test';
  const TURN_ONE = '3f1a2b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b';
  const TURN_TWO = '11111111-2222-3333-4444-555555555555';

  function draft(chatJid: string, turnId: string, text: string): DraftHubEvent {
    return { type: 'draft', chatJid, turnId, text };
  }

  function end(
    chatJid: string,
    turnId: string,
    outcome: 'sent' | 'failed' = 'sent',
  ): DraftHubEvent {
    return { type: 'end', chatJid, turnId, outcome };
  }

  function fakeDrafts() {
    let listener: ((event: DraftHubEvent) => void) | undefined;
    const close = vi.fn((): void => {
      listener = undefined;
    });
    const open = vi.fn((onEvent: (event: DraftHubEvent) => void): (() => void) => {
      listener = onEvent;
      return close;
    });
    return {
      open,
      close,
      emit: (event: DraftHubEvent): void => listener?.(event),
    };
  }

  it('opens the stream after boot and grows the draft in place', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    expect(drafts.open).toHaveBeenCalledTimes(1);

    drafts.emit(draft(CHAT, TURN_ONE, 'Hel'));
    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Hel' });

    drafts.emit(draft(CHAT, TURN_ONE, 'Hello there'));
    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Hello there' });
  });

  it('replaces the draft with a message that arrives before end, in one update', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));

    const seen: Array<{ draft: boolean; message: boolean }> = [];
    const unsubscribe = store.subscribe((state) => {
      seen.push({
        draft: state.drafts[CHAT] !== undefined,
        message: state.messages(CHAT).some((item) => item.text === 'Hello'),
      });
    });

    xmpp.emit(
      'message',
      message({
        id: 'ai-1',
        chatJid: CHAT,
        body: 'Hello',
        fromJid: CHAT,
        timestamp: new Date('2026-09-28T12:00:05Z'),
      }),
    );
    unsubscribe();

    expect(store.getState().drafts[CHAT]).toBeUndefined();
    expect(
      store
        .getState()
        .messages(CHAT)
        .some((item) => item.text === 'Hello'),
    ).toBe(true);
    // Exactly one of the two is on screen in every update: never both (a
    // duplicate) and never neither (a gap).
    for (const snapshot of seen) {
      expect(snapshot.draft !== snapshot.message).toBe(true);
    }

    drafts.emit(draft(CHAT, TURN_ONE, 'Hello there'));
    expect(store.getState().drafts[CHAT]).toBeUndefined();
  });

  it('keeps the draft after end until the message arrives', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hi'));
    drafts.emit(end(CHAT, TURN_ONE));

    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Hi' });

    xmpp.emit('message', message({ id: 'ai-2', chatJid: CHAT, body: 'Hi', fromJid: CHAT }));
    expect(store.getState().drafts[CHAT]).toBeUndefined();
  });

  it('keeps the draft when my own JID sends a message during the turn', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Half a sentence'));

    // A message from my own JID (e.g. my second device) is not the AI's reply.
    xmpp.emit(
      'message',
      message({
        id: 'mine-1',
        chatJid: CHAT,
        body: 'note to self',
        fromJid: 'me@galena.test',
        timestamp: new Date('2026-09-28T12:00:05Z'),
      }),
    );

    expect(store.getState().drafts[CHAT]).toEqual({
      turnId: TURN_ONE,
      text: 'Half a sentence',
    });

    // The turn is not finished: a later draft still applies.
    drafts.emit(draft(CHAT, TURN_ONE, 'Half a sentence, then more'));
    expect(store.getState().drafts[CHAT]).toEqual({
      turnId: TURN_ONE,
      text: 'Half a sentence, then more',
    });
  });

  it('drops a finished draft after the fallback when no message arrives', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    vi.useFakeTimers();
    try {
      drafts.emit(draft(CHAT, TURN_ONE, 'Hi'));
      drafts.emit(end(CHAT, TURN_ONE));
      expect(store.getState().drafts[CHAT]).toBeDefined();

      vi.advanceTimersByTime(DRAFT_END_FALLBACK_MS - 1);
      expect(store.getState().drafts[CHAT]).toBeDefined();

      vi.advanceTimersByTime(1);
      expect(store.getState().drafts[CHAT]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a draft that sees no further event for a minute', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    vi.useFakeTimers();
    try {
      drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));

      vi.advanceTimersByTime(DRAFT_IDLE_MS - 1);
      expect(store.getState().drafts[CHAT]).toBeDefined();

      vi.advanceTimersByTime(1);
      expect(store.getState().drafts[CHAT]).toBeUndefined();

      // An idle turn is not finished: if it resumes (a slow tool call), its
      // next draft shows again.
      drafts.emit(draft(CHAT, TURN_ONE, 'Hello, resumed'));
      expect(store.getState().drafts[CHAT]?.text).toBe('Hello, resumed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a draft alive while it keeps being refreshed, then expires it', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    vi.useFakeTimers();
    try {
      drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));
      vi.advanceTimersByTime(50_000);
      expect(store.getState().drafts[CHAT]).toBeDefined();

      // The 50 s refresh re-arms the idle timer.
      drafts.emit(draft(CHAT, TURN_ONE, 'Hello again'));
      vi.advanceTimersByTime(50_000);
      expect(store.getState().drafts[CHAT]?.text).toBe('Hello again');

      vi.advanceTimersByTime(10_000);
      expect(store.getState().drafts[CHAT]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the latest text when a turn shrinks (a tool call restarts it)', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });

    drafts.emit(draft(CHAT, TURN_ONE, 'Let me check that'));
    drafts.emit(draft(CHAT, TURN_ONE, 'Done'));

    expect(store.getState().drafts[CHAT]?.text).toBe('Done');
  });

  it('records which message finished the draft turn', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));

    xmpp.emit('message', message({ id: 'ai-1', chatJid: CHAT, body: 'Hello', fromJid: CHAT }));

    expect(store.getState().finishedDraftMessages['ai-1']).toBe(TURN_ONE);
  });

  it('caps the finished-draft message record', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open });

    for (let index = 0; index < 51; index += 1) {
      drafts.emit(draft(CHAT, `turn-${index}`, `text ${index}`));
      xmpp.emit(
        'message',
        message({ id: `ai-${index}`, chatJid: CHAT, body: `text ${index}`, fromJid: CHAT }),
      );
    }

    const record = store.getState().finishedDraftMessages;
    expect(Object.keys(record)).toHaveLength(50);
    expect(record['ai-0']).toBeUndefined();
    expect(record['ai-50']).toBe('turn-50');
  });

  it('clears the finished-draft message record on stop and signOut', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));
    xmpp.emit('message', message({ id: 'ai-1', chatJid: CHAT, body: 'Hello', fromJid: CHAT }));
    expect(store.getState().finishedDraftMessages['ai-1']).toBe(TURN_ONE);

    store.getState().stop();
    expect(store.getState().finishedDraftMessages).toEqual({});

    store.getState().start();
    await flush();
    drafts.emit(draft(CHAT, TURN_TWO, 'Bye'));
    xmpp.emit('message', message({ id: 'ai-2', chatJid: CHAT, body: 'Bye', fromJid: CHAT }));
    expect(store.getState().finishedDraftMessages['ai-2']).toBe(TURN_TWO);

    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    try {
      await store.getState().signOut();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(store.getState().finishedDraftMessages).toEqual({});
  });

  it('lets the next turn replace a finished draft without a stale fallback', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'first'));
    drafts.emit(end(CHAT, TURN_ONE));

    vi.useFakeTimers();
    try {
      drafts.emit(draft(CHAT, TURN_TWO, 'second'));
      expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_TWO, text: 'second' });

      vi.advanceTimersByTime(DRAFT_END_FALLBACK_MS + 1);
      expect(store.getState().drafts[CHAT]?.turnId).toBe(TURN_TWO);
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the stream on stop and never leaves two open', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    expect(drafts.open).toHaveBeenCalledTimes(1);

    store.getState().start();
    await flush();
    expect(drafts.open).toHaveBeenCalledTimes(1);

    store.getState().stop();
    expect(drafts.close).toHaveBeenCalledTimes(1);
    expect(store.getState().drafts).toEqual({});

    store.getState().start();
    await flush();
    expect(drafts.open).toHaveBeenCalledTimes(2);
    expect(drafts.close).toHaveBeenCalledTimes(1);
  });

  it('closes the stream on signOut', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open });
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    try {
      await store.getState().signOut();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(drafts.close).toHaveBeenCalledTimes(1);
    expect(store.getState().drafts).toEqual({});
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

describe('attachments (T-0065)', () => {
  function fakeAttachments(overrides: Partial<AttachmentPort> = {}): AttachmentPort {
    return {
      classify: () => 'image',
      readImageSize: vi.fn(async () => ({ width: 800, height: 600 })),
      upload: vi.fn(async () => 'http://upload.galena.test/get/1/photo.png'),
      ...overrides,
    };
  }

  function imageFile(): File {
    return new File(['abcd'], 'photo.png', { type: 'image/png' });
  }

  it('shows an optimistic image at once, then sends the payload with the upload', async () => {
    const attachments = fakeAttachments();
    const { store, xmpp } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@galena.test', imageFile(), { caption: 'the stage' });

    const optimistic = store.getState().messages('ana@galena.test').at(-1);
    expect(optimistic?.attachment?.kind).toBe('image');
    expect(optimistic?.attachment?.name).toBe('photo.png');
    expect(optimistic?.text).toBe('the stage');
    expect(optimistic?.status).toBe('sending');

    await flush();

    expect(attachments.upload).toHaveBeenCalledTimes(1);
    expect(xmpp.core.sendMessage).toHaveBeenCalledWith('ana@galena.test', 'chat', 'the stage', {
      payload: {
        v: 0,
        type: 'attachment',
        data: {
          kind: 'image',
          url: 'http://upload.galena.test/get/1/photo.png',
          name: 'photo.png',
          size: 4,
          mime: 'image/png',
          width: 800,
          height: 600,
        },
      },
    });
    const sent = store.getState().messages('ana@galena.test').at(-1);
    expect(sent?.attachment?.url).toBe('http://upload.galena.test/get/1/photo.png');
    expect(sent?.status).toBe('sent');
  });

  it('marks a failed upload failed and retries it from the kept file', async () => {
    let attempt = 0;
    const upload = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new AttachmentError('upload_failed', 'nope');
      }
      return 'http://upload.galena.test/get/1/photo.png';
    });
    const attachments = fakeAttachments({ upload });
    const { store } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@galena.test', imageFile(), { caption: 'retry me' });
    await flush();

    const failed = store.getState().messages('ana@galena.test').at(-1);
    expect(failed?.failed).toBe(true);
    expect(failed?.status).toBe('sending');
    expect(failed?.attachment?.url).toBe('');

    store.getState().retryAttachment('ana@galena.test', failed?.id ?? '');
    expect(store.getState().messages('ana@galena.test').at(-1)?.failed).toBeUndefined();

    await flush();

    const retried = store.getState().messages('ana@galena.test').at(-1);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(retried?.failed).toBeUndefined();
    expect(retried?.status).toBe('sent');
    expect(retried?.attachment?.url).toBe('http://upload.galena.test/get/1/photo.png');
  });

  it('carries the reply target on the sent payload', async () => {
    const attachments = fakeAttachments();
    const { store, xmpp } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@galena.test', imageFile(), {
      caption: 'look',
      replyTo: { id: 'ana-2', senderName: 'Ana', text: 'newest' },
    });
    await flush();

    expect(xmpp.core.sendMessage).toHaveBeenCalledWith(
      'ana@galena.test',
      'chat',
      'look',
      expect.objectContaining({ replyTo: { id: 'ana-2' } }),
    );
  });

  it('maps an incoming attachment payload', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-in',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'file',
            url: 'http://upload.galena.test/get/1/plan.pdf',
            name: 'plan.pdf',
            size: 2048,
            mime: 'application/pdf',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'att-in');
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment?.name).toBe('plan.pdf');
  });

  it('ignores a payload that is not an attachment and keeps the body', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'not-att',
        chatJid: 'ana@galena.test',
        body: 'just text',
        payload: {
          v: 0,
          type: 'voice',
          data: { duration_ms: 1000, mime: 'audio/mp4', waveform: [1] },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'not-att');
    expect(incoming?.attachment).toBeUndefined();
    expect(incoming?.text).toBe('just text');
    expect(incoming?.voice?.duration_ms).toBe(1000);
  });

  it('keeps the audio URL of an incoming voice message on a trusted host', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'voice-trusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'voice',
          data: {
            duration_ms: 1000,
            mime: 'audio/mp4',
            waveform: [10, 20],
            url: 'https://upload.galena.test/upload/abc/voice.m4a',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'voice-trusted');
    expect(incoming?.voice?.url).toBe('https://upload.galena.test/upload/abc/voice.m4a');
  });

  it('drops the audio URL of an incoming voice message on an untrusted host', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'voice-untrusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'voice',
          data: {
            duration_ms: 1000,
            mime: 'audio/mp4',
            waveform: [10, 20],
            url: 'https://tracker.example.com/beacon.m4a',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'voice-untrusted');
    expect(incoming?.voice).toBeDefined();
    expect(incoming?.voice?.duration_ms).toBe(1000);
    expect(incoming?.voice?.url).toBeUndefined();
  });

  it('keeps an incoming image attachment on a trusted host as an image', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-trusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://upload.galena.test/upload/abc/stage.png',
            name: 'stage.png',
            size: 200,
            mime: 'image/png',
            width: 800,
            height: 600,
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'att-trusted');
    expect(incoming?.attachment?.kind).toBe('image');
    expect(incoming?.attachment?.width).toBe(800);
    expect(incoming?.attachment?.height).toBe(600);
  });

  it('downgrades an incoming image attachment on an untrusted host to a file', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-untrusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://tracker.example.com/pixel.png',
            name: 'pixel.png',
            size: 200,
            mime: 'image/png',
            width: 1,
            height: 1,
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'att-untrusted');
    expect(incoming?.attachment?.kind).toBe('file');
    // Width/height must not leak through, otherwise the bubble would still
    // reserve image-sized space before the user clicks the card.
    expect(incoming?.attachment?.width).toBeUndefined();
    expect(incoming?.attachment?.height).toBeUndefined();
    expect(incoming?.attachment?.url).toBe('https://tracker.example.com/pixel.png');
  });

  it('keeps an incoming file attachment on an untrusted host as a file', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-file-untrusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'file',
            url: 'https://files.example.com/random.bin',
            name: 'random.bin',
            size: 200,
            mime: 'application/octet-stream',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@galena.test')
      .find((m) => m.id === 'att-file-untrusted');
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment?.url).toBe('https://files.example.com/random.bin');
  });

  it('maps history attachments through the same trusted-host check', async () => {
    const xmpp = fakeXmpp();
    xmpp.history['ana@galena.test'] = [
      message({
        id: 'att-history-trusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://upload.galena.test/upload/abc/photo.png',
            name: 'photo.png',
            size: 100,
            mime: 'image/png',
            width: 100,
            height: 100,
          },
        },
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      message({
        id: 'att-history-untrusted',
        chatJid: 'ana@galena.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://tracker.example.com/x.png',
            name: 'x.png',
            size: 100,
            mime: 'image/png',
            width: 100,
            height: 100,
          },
        },
        timestamp: new Date('2026-09-28T09:01:00Z'),
      }),
    ];

    const store = createRealChatStore({
      api: fakeApi(),
      storage: memoryStorage(),
      now: () => new Date('2026-09-28T12:00:00Z'),
      createXmpp: (options) => {
        xmpp.options.current = options;
        return xmpp.core;
      },
    });
    store.getState().start();
    store.getState().openChat('ana@galena.test');
    await flush();

    const list = store.getState().messages('ana@galena.test');
    const trusted = list.find((m) => m.id === 'att-history-trusted');
    const untrusted = list.find((m) => m.id === 'att-history-untrusted');
    expect(trusted?.attachment?.kind).toBe('image');
    expect(untrusted?.attachment?.kind).toBe('file');
    expect(untrusted?.attachment?.width).toBeUndefined();
    expect(untrusted?.attachment?.height).toBeUndefined();
  });
});
