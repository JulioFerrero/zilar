import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import { AuthProvider } from '@/auth/AuthProvider';
import { MessageBubble } from '@/components/MessageBubble';
import { ChatStoreProvider } from '@/store/ChatStoreProvider';
import type { DraftHubEvent } from '@/lib/drafts';
import { AttachmentError, type AttachmentPort } from '@/lib/attachments';
import { VoiceError } from '@/lib/voice';
import {
  CONNECT_RETRY_DELAYS_MS,
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  SEND_TIMEOUT_MS,
  createRealChatStore,
  sendFailureReasonFor,
  type ApiClient,
  type RealStoreDeps,
  type StorageLike,
} from './realStore';
import type { Pin } from '@/lib/api';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';

// Sign-out must not hit Better Auth over the network in a test.
vi.mock('@/lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => ({})) },
}));

// The server-owner answer is cached per session and must not outlive sign-out.
vi.mock('@/lib/useIsServerOwner', () => ({ resetIsServerOwnerCache: vi.fn() }));

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
    fromJid: 'ana@zilar.test',
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
    fromJid: overrides.fromJid ?? 'ana@zilar.test',
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
    fromJid: overrides.fromJid ?? 'ana@zilar.test',
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
    fromJid: overrides.fromJid ?? 'ana@zilar.test',
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
    me: () => 'me@zilar.test',
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
      putUrl: 'http://upload.zilar.test/put/1',
      getUrl: 'http://upload.zilar.test/get/1/voice.m4a',
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
      email: 'me@zilar.test',
      name: 'Me',
      image: null,
      jid: 'me@zilar.test',
    })),
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
      {
        kind: 'group' as const,
        chatJid: 'team@rooms.zilar.test',
        title: 'Team',
        groupId: 'g1',
        memberCount: 3,
        role: 'member' as const,
      },
    ]),
    getContacts: vi.fn(async () => [{ userId: 'u-ana', name: 'Ana', jid: 'ana@zilar.test' }]),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    getXmppToken: vi.fn(async () => ({
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
    createGroup: vi.fn(async () => ({
      id: 'g2',
      title: 'New',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    createInvite: vi.fn(async () => ({ code: 'c', url: 'http://x/invite/c' })),
    createGroupInviteLink: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listGroupInviteLinks: vi.fn(async () => []),
    listGroupMembers: vi.fn(async () => []),
    revokeGroupInviteLink: vi.fn(async () => {}),
    previewJoinLink: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    joinByLink: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    changeGroupMemberRole: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    removeGroupMember: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    setGroupVisibility: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    searchDirectory: vi.fn(async () => ({ entries: [], next: null })),
    lookupGroupByHandle: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    joinPublicGroup: vi.fn(async () => {
      throw new Error('not implemented');
    }),
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
    setTopicRoles: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    setMembersCanCreateTopics: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [],
      ais: [],
    })),
    listChatPrefs: vi.fn(async () => []),
    putChatPref: vi.fn(async () => null),
    listPins: vi.fn(async () => []),
    pinMessage: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    unpinMessage: vi.fn(async () => {}),
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
  xmpp.history['ana@zilar.test'] = [
    message({
      id: 'ana-1',
      chatJid: 'ana@zilar.test',
      body: 'older',
      timestamp: new Date('2026-09-28T09:00:00Z'),
    }),
    message({
      id: 'ana-2',
      chatJid: 'ana@zilar.test',
      body: 'newest',
      timestamp: new Date('2026-09-28T10:00:00Z'),
    }),
  ];
  xmpp.history['team@rooms.zilar.test'] = [
    message({
      id: 'team-1',
      chatJid: 'team@rooms.zilar.test',
      body: 'group hello',
      fromJid: 'ana@zilar.test',
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
    expect(chats.map((chat) => chat.id)).toEqual(['team@rooms.zilar.test', 'ana@zilar.test']);
    expect(chats.find((chat) => chat.id === 'ana@zilar.test')?.lastMessage?.text).toBe('newest');
    expect(chats.find((chat) => chat.id === 'team@rooms.zilar.test')?.lastMessage?.text).toBe(
      'group hello',
    );
    expect(store.getState().currentUserId).toBe('u-me');
  });

  it('merges server prefs into summaries on boot', async () => {
    const { store } = await setup({
      listChatPrefs: vi.fn(async () => [
        {
          chatJid: 'ana@zilar.test',
          mutedUntil: '2026-09-28T13:00:00.000Z',
          archived: false,
          pinnedAt: '2026-09-28T11:00:00.000Z',
          updatedAt: '2026-09-28T11:00:00.000Z',
        },
      ]),
    });
    const ana = store.getState().chats.find((chat) => chat.id === 'ana@zilar.test');
    expect(ana?.muted).toBe(true);
    expect(ana?.pinnedAt).toEqual(new Date('2026-09-28T11:00:00.000Z'));
    expect(store.getState().chatPrefs['ana@zilar.test']?.mutedUntil).toBe(
      '2026-09-28T13:00:00.000Z',
    );
  });

  it('pins optimistically and rolls back when the PUT fails', async () => {
    const putChatPref = vi.fn(async () => ({
      chatJid: 'ana@zilar.test',
      mutedUntil: null,
      archived: false,
      pinnedAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
    }));
    const { store } = await setup({ putChatPref });

    await store.getState().setPinned('ana@zilar.test', true);
    expect(putChatPref).toHaveBeenCalledWith('ana@zilar.test', { pinned: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.pinnedAt).toEqual(
      new Date('2026-09-28T12:00:00.000Z'),
    );

    putChatPref.mockRejectedValueOnce(new Error('offline'));
    await expect(store.getState().setPinned('ana@zilar.test', false)).rejects.toThrow('offline');
    // The rollback restores the pinned state.
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.pinnedAt).toEqual(
      new Date('2026-09-28T12:00:00.000Z'),
    );
  });

  it('re-syncs the app badge when mute changes the total (round 5)', async () => {
    const badges: number[] = [];
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'setAppBadge');
    const clearDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'clearAppBadge');
    Object.defineProperty(window.navigator, 'setAppBadge', {
      value: async (count: number) => {
        badges.push(count);
      },
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'clearAppBadge', {
      value: async () => {
        badges.push(0);
      },
      configurable: true,
    });
    try {
      const putChatPref = vi.fn(async (): Promise<import('@/lib/api').ChatPref | null> => null);
      const { store, xmpp } = await setup({ putChatPref });

      // A live message bumps Ana to unread 1 and the badge follows.
      xmpp.emit('message', message({ chatJid: 'ana@zilar.test', body: 'live badge' }));
      await flush();
      expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.unread).toBe(1);
      expect(badges.at(-1)).toBe(1);

      // Muting drops Ana out of the badge total.
      putChatPref.mockImplementationOnce(async () => ({
        chatJid: 'ana@zilar.test',
        mutedUntil: '2026-09-28T13:00:00.000Z',
        archived: false,
        pinnedAt: null,
        updatedAt: '2026-09-28T12:00:00.000Z',
      }));
      await store.getState().setMuted('ana@zilar.test', 'hour');
      expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);
      expect(badges.at(-1)).toBe(0);

      // Unmuting brings the unread back into the badge.
      await store.getState().setMuted('ana@zilar.test', null);
      expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(
        false,
      );
      expect(badges.at(-1)).toBe(1);
    } finally {
      if (navigatorDescriptor === undefined) {
        delete (window.navigator as { setAppBadge?: unknown }).setAppBadge;
      } else {
        Object.defineProperty(window.navigator, 'setAppBadge', navigatorDescriptor);
      }
      if (clearDescriptor === undefined) {
        delete (window.navigator as { clearAppBadge?: unknown }).clearAppBadge;
      } else {
        Object.defineProperty(window.navigator, 'clearAppBadge', clearDescriptor);
      }
    }
  });
  it('mutes and archives with rollback on failure', async () => {
    const putChatPref = vi.fn(async () => null);
    const { store } = await setup({ putChatPref });

    await store.getState().setMuted('ana@zilar.test', 'hour');
    expect(putChatPref).toHaveBeenCalledWith('ana@zilar.test', {
      mutedUntil: '2026-09-28T13:00:00.000Z',
    });
    // The mock PUT answered null (defaults deleted), so the chat reads unmuted.
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(false);

    putChatPref.mockRejectedValueOnce(new Error('offline'));
    await expect(store.getState().setArchived('team@rooms.zilar.test', true)).rejects.toThrow(
      'offline',
    );
    expect(
      store.getState().chats.find((chat) => chat.id === 'team@rooms.zilar.test')?.archived,
    ).toBeUndefined();
  });

  it('drops the pref row when the PUT answers defaults-deleted', async () => {
    const putChatPref = vi.fn(async () => null);
    const { store } = await setup({
      putChatPref,
      listChatPrefs: vi.fn(async () => [
        {
          chatJid: 'ana@zilar.test',
          mutedUntil: '2026-09-28T13:00:00.000Z',
          archived: false,
          pinnedAt: null,
          updatedAt: '2026-09-28T11:00:00.000Z',
        },
      ]),
    });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);
    await store.getState().setMuted('ana@zilar.test', null);
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(false);
    expect(store.getState().chatPrefs['ana@zilar.test']).toBeUndefined();
  });

  it('updates the preview and unread count from a live message', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'ana-3',
        chatJid: 'ana@zilar.test',
        body: 'live one',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@zilar.test');
    expect(chat?.lastMessage?.text).toBe('live one');
    expect(chat?.unread).toBe(1);
    expect(store.getState().messages('ana@zilar.test').at(-1)?.id).toBe('ana-3');
    // The chat with the newest message moves to the top.
    expect(store.getState().chats[0]?.id).toBe('ana@zilar.test');
  });

  it('clears unread and sends a displayed marker when a chat is opened', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit(
      'message',
      message({
        id: 'ana-3',
        chatJid: 'ana@zilar.test',
        body: 'unread',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.unread).toBe(1);

    store.getState().openChat('ana@zilar.test');
    await flush();

    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.unread).toBe(0);
    expect(xmpp.core.markDisplayed).toHaveBeenCalledWith(
      'ana@zilar.test',
      'chat',
      expect.any(String),
    );
  });

  it('adds a sent message optimistically and confirms it without duplicating the echo', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@zilar.test', 'hello there');
    const optimist = store.getState().messages('ana@zilar.test').at(-1);
    expect(optimist?.text).toBe('hello there');
    expect(optimist?.status).toBe('sending');

    await flush();
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((item) => item.text === 'hello there')?.status,
    ).toBe('sent');

    xmpp.emit(
      'message',
      message({
        id: 'srv-1',
        chatJid: 'ana@zilar.test',
        body: 'hello there',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    const matches = store
      .getState()
      .messages('ana@zilar.test')
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
      upload: vi.fn(async () => 'http://upload.zilar.test/get/1/voice.m4a'),
    };
    const { store, xmpp } = await setup({}, voice);

    store.getState().sendVoice('ana@zilar.test', {
      blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }),
      // The client's own duration must not reach the payload.
      durationMs: 9999,
      waveform: [1, 2, 3],
    });

    const optimistic = store.getState().messages('ana@zilar.test').at(-1);
    expect(optimistic?.voice?.duration_ms).toBe(9999);
    expect(optimistic?.status).toBe('sending');

    await flush();

    expect(voice.convert).toHaveBeenCalledTimes(1);
    expect(voice.upload).toHaveBeenCalledTimes(1);
    expect(xmpp.core.sendMessage).toHaveBeenCalledWith('ana@zilar.test', 'chat', '', {
      payload: {
        v: 0,
        type: 'voice',
        data: {
          duration_ms: 4321,
          mime: 'audio/mp4',
          waveform: [1, 2, 3],
          url: 'http://upload.zilar.test/get/1/voice.m4a',
        },
      },
    });
    const sent = store.getState().messages('ana@zilar.test').at(-1);
    expect(sent?.voice?.duration_ms).toBe(4321);
    expect(sent?.voice?.url).toBe('http://upload.zilar.test/get/1/voice.m4a');
    expect(sent?.status).toBe('sent');
  });

  it('updates the list preview when the optimistic send is confirmed', async () => {
    const { store } = await setup();

    store.getState().sendText('ana@zilar.test', 'hello there');
    await flush();

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@zilar.test');
    const bubble = store.getState().messages('ana@zilar.test').at(-1);
    expect(chat?.lastMessage?.status).toBe('sent');
    expect(bubble?.status).toBe('sent');
  });

  it('marks the bubble and the list read when a displayed marker arrives', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@zilar.test', 'read me');
    await flush();
    // `sendMessage` resolves with the id the server echoes back.
    xmpp.emit('displayed', {
      chatJid: 'ana@zilar.test',
      fromJid: 'ana@zilar.test',
      messageId: 'srv-1',
    });

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@zilar.test');
    const bubble = store.getState().messages('ana@zilar.test').at(-1);
    expect(chat?.lastMessage?.status).toBe('read');
    expect(bubble?.status).toBe('read');
  });

  it('keeps the bubble and the list in agreement through sending and reading', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@zilar.test', 'agree');
    const sending = store.getState().messages('ana@zilar.test').at(-1);
    expect(sending?.status).toBe('sending');
    expect(
      store.getState().chats.find((entry) => entry.id === 'ana@zilar.test')?.lastMessage?.status,
    ).toBe('sending');

    await flush();
    expect(
      store.getState().chats.find((entry) => entry.id === 'ana@zilar.test')?.lastMessage?.status,
    ).toBe('sent');

    xmpp.emit('displayed', {
      chatJid: 'ana@zilar.test',
      fromJid: 'ana@zilar.test',
      messageId: 'srv-1',
    });
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((item) => item.text === 'agree')?.status,
    ).toBe('read');
    expect(
      store.getState().chats.find((entry) => entry.id === 'ana@zilar.test')?.lastMessage?.status,
    ).toBe('read');
  });

  it('keeps a message read when the server echo arrives after a displayed marker', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@zilar.test', 'late echo');
    await flush();
    xmpp.emit('displayed', {
      chatJid: 'ana@zilar.test',
      fromJid: 'ana@zilar.test',
      messageId: 'srv-1',
    });
    xmpp.emit(
      'message',
      message({
        id: 'srv-1',
        chatJid: 'ana@zilar.test',
        body: 'late echo',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    const chat = store.getState().chats.find((entry) => entry.id === 'ana@zilar.test');
    const bubble = store
      .getState()
      .messages('ana@zilar.test')
      .find((item) => item.text === 'late echo');
    expect(bubble?.status).toBe('read');
    expect(chat?.lastMessage?.status).toBe('read');
  });

  it('ignores my own typing reflected from a group', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'me@zilar.test',
      state: 'composing',
    });
    expect(store.getState().typing['team@rooms.zilar.test']).toBeUndefined();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'ana@zilar.test',
      state: 'composing',
    });
    expect(store.getState().typing['team@rooms.zilar.test']?.names).toEqual(['Ana']);
  });

  it('ignores my own displayed marker reflected from a group', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('team@rooms.zilar.test', 'mine');
    await flush();

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'me@zilar.test',
      messageId: 'srv-1',
    });
    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.status).toBe('sent');
    expect(
      store.getState().chats.find((entry) => entry.id === 'team@rooms.zilar.test')?.lastMessage
        ?.status,
    ).toBe('sent');

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'ana@zilar.test',
      messageId: 'srv-1',
    });
    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.status).toBe('read');
  });

  it('ignores an unresolved own typing reflection from a group', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'team@rooms.zilar.test/mynick',
      state: 'composing',
      outgoing: true,
    });

    expect(store.getState().typing['team@rooms.zilar.test']).toBeUndefined();
  });

  it('ignores an unresolved own displayed reflection from a group', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('team@rooms.zilar.test', 'mine');
    await flush();

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'team@rooms.zilar.test/mynick',
      messageId: 'srv-1',
      outgoing: true,
    });

    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.status).toBe('sent');
    expect(
      store.getState().chats.find((entry) => entry.id === 'team@rooms.zilar.test')?.lastMessage
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
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'u-luis@zilar.test',
      state: 'composing',
    });

    expect(store.getState().typing['team@rooms.zilar.test']?.names).toEqual(['Luis']);
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
        chatJid: 'team@rooms.zilar.test',
        body: 'hi @Ana',
        fromJid: 'u-ana@zilar.test',
        mentions: [{ jid: 'u-ana@zilar.test', begin: 3, end: 7 }],
      }),
    );

    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.mentions).toEqual([
      { jid: 'u-ana@zilar.test', name: 'Ana', begin: 3, end: 7 },
    ]);
  });

  it('falls back to the text at the range for an unknown mention', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'team-3',
        chatJid: 'team@rooms.zilar.test',
        body: 'hi @Zed',
        fromJid: 'u-zed@zilar.test',
        mentions: [{ jid: 'zed@zilar.test', begin: 3, end: 7 }],
      }),
    );

    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.mentions).toEqual([
      { jid: 'zed@zilar.test', name: '@Zed', begin: 3, end: 7 },
    ]);
  });

  it('ignores a mention without usable offsets', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'team-4',
        chatJid: 'team@rooms.zilar.test',
        body: 'hi @Ana',
        fromJid: 'u-ana@zilar.test',
        mentions: [{ jid: 'u-ana@zilar.test' }],
      }),
    );

    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.mentions).toBeUndefined();
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
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    expect(store.getState().groupMembers('team@rooms.zilar.test')).toEqual([
      { jid: 'u-me@zilar.test', name: 'Me' },
      { jid: 'u-ana@zilar.test', name: 'Ana' },
    ]);
  });

  it('includes the group AIs in groupMembers', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@zilar.test', name: 'Dev-1', ownerId: 'u-me' }],
    }));
    const { store } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    expect(store.getState().groupMembers('team@rooms.zilar.test')).toEqual([
      { jid: 'u-me@zilar.test', name: 'Me' },
      { jid: 'ai-dev-1@zilar.test', name: 'Dev-1' },
    ]);
    expect(store.getState().groupInfo('team@rooms.zilar.test')?.ais).toEqual([
      { aiId: 'dev-1', jid: 'ai-dev-1@zilar.test', name: 'Dev-1', ownerId: 'u-me' },
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
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@zilar.test', name: 'Dev-1', ownerId: 'u-me' }],
    };
    const getGroup = vi.fn(async () => before);
    const addGroupAi = vi.fn(async () => after);
    const { store } = await setup({ getGroup, addGroupAi });
    await flush();
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    await store.getState().addGroupAi('team@rooms.zilar.test', 'dev-1');

    expect(addGroupAi).toHaveBeenCalledWith('g1', 'dev-1');
    expect(store.getState().groupMembers('team@rooms.zilar.test')).toContainEqual({
      jid: 'ai-dev-1@zilar.test',
      name: 'Dev-1',
    });
    expect(store.getState().groupInfo('team@rooms.zilar.test')?.ais).toHaveLength(1);
  });

  it('removes an AI through the API and refreshes the members', async () => {
    const before = {
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@zilar.test', name: 'Dev-1', ownerId: 'u-me' }],
    };
    const after = { ...before, ais: [] };
    const getGroup = vi.fn(async () => before);
    const removeGroupAi = vi.fn(async () => after);
    const { store } = await setup({ getGroup, removeGroupAi });
    await flush();
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    await store.getState().removeGroupAi('team@rooms.zilar.test', 'dev-1');

    expect(removeGroupAi).toHaveBeenCalledWith('g1', 'dev-1');
    expect(store.getState().groupMembers('team@rooms.zilar.test')).toEqual([
      { jid: 'u-me@zilar.test', name: 'Me' },
    ]);
  });

  it('names a group AI message from the group AIs and renders it as AI Markdown', async () => {
    const getGroup = vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
      createdBy: 'u-me',
      members: [{ userId: 'u-me', name: 'Me', role: 'owner' as const }],
      ais: [{ aiId: 'dev-1', jid: 'ai-dev-1@zilar.test', name: 'Dev-1', ownerId: 'u-me' }],
    }));
    const { store, xmpp } = await setup({ getGroup });
    await flush();
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    xmpp.emit(
      'message',
      message({
        id: 'ai-msg-1',
        chatJid: 'team@rooms.zilar.test',
        body: '**done**',
        fromJid: 'ai-dev-1@zilar.test',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    const last = store.getState().messages('team@rooms.zilar.test').at(-1);
    const chat = store.getState().chats.find((entry) => entry.id === 'team@rooms.zilar.test');
    expect(last?.senderName).toBe('Dev-1');
    if (last === undefined || chat === undefined) {
      throw new Error('the group AI message was not stored');
    }

    const { container } = render(
      <AuthProvider
        value={{
          status: 'authenticated',
          user: { id: 'u-me', name: 'Me', email: 'me@zilar.test' },
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

    store.getState().sendText('team@rooms.zilar.test', 'hi @Ana', {
      mentions: [{ jid: 'u-ana@zilar.test', name: 'Ana', begin: 3, end: 7 }],
    });

    expect(xmpp.core.sendMessage).toHaveBeenCalledWith(
      'team@rooms.zilar.test',
      'groupchat',
      'hi @Ana',
      { mentions: [{ jid: 'u-ana@zilar.test', begin: 3, end: 7 }] },
    );
    expect(store.getState().messages('team@rooms.zilar.test').at(-1)?.mentions).toEqual([
      { jid: 'u-ana@zilar.test', name: 'Ana', begin: 3, end: 7 },
    ]);
  });

  it('shows Someone instead of a JID localpart for an unknown group sender', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'z9y8x7@zilar.test',
      state: 'composing',
    });

    expect(store.getState().typing['team@rooms.zilar.test']?.names).toEqual(['Someone']);
  });

  it('uses the occupant nick when a group sender is not a known member', async () => {
    const { store, xmpp } = await setup();
    vi.mocked(xmpp.core.occupants).mockReturnValue([
      {
        jid: 'team@rooms.zilar.test/pablo',
        nick: 'Pablo',
        available: true,
        realJid: 'pablo@zilar.test',
      },
    ]);

    xmpp.emit('typing', {
      chatJid: 'team@rooms.zilar.test',
      fromJid: 'pablo@zilar.test',
      state: 'composing',
    });

    expect(store.getState().typing['team@rooms.zilar.test']?.names).toEqual(['Pablo']);
  });

  it('paginates older messages on demand', async () => {
    const history = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `ana-${index}`,
        chatJid: 'ana@zilar.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = history;

    store.getState().openChat('ana@zilar.test');
    await flush();

    expect(store.getState().messages('ana@zilar.test')).toHaveLength(50);
    expect(store.getState().hasMore('ana@zilar.test')).toBe(true);

    store.getState().loadOlder('ana@zilar.test');
    await flush();

    expect(store.getState().messages('ana@zilar.test')).toHaveLength(60);
    expect(store.getState().messages('ana@zilar.test')[0]?.id).toBe('ana-0');
    expect(store.getState().hasMore('ana@zilar.test')).toBe(false);
  });

  it('opens a chat at a loaded message without paging', async () => {
    const { store } = await setup();
    const found = await store.getState().openAtMessage('ana@zilar.test', 'ana-2');
    expect(found.id).toBe('ana-2');
    expect(store.getState().activeChatId).toBe('ana@zilar.test');
  });

  it('pages backwards until a far-back message is loaded', async () => {
    const history = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `ana-${index}`,
        chatJid: 'ana@zilar.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = history;

    const found = await store.getState().openAtMessage('ana@zilar.test', 'ana-3');
    expect(found.text).toBe('msg 3');
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .some((item) => item.id === 'ana-3'),
    ).toBe(true);
  });

  it('rejects message_not_found when history runs out', async () => {
    const { store } = await setup();
    await expect(store.getState().openAtMessage('ana@zilar.test', 'ghost')).rejects.toThrow(
      'message_not_found',
    );
  });

  describe('pinned messages (T-0114)', () => {
    function pinRow(messageId: string, text = 'pinned text'): Pin {
      return {
        id: `pin-${messageId}`,
        chat: 'ana@zilar.test',
        messageId,
        senderName: 'Ana',
        text,
        kind: 'text',
        pinnedBy: 'u-me',
        pinnedAt: '2026-09-28T11:00:00.000Z',
      };
    }

    it('loads pins when a chat opens', async () => {
      const { store, api } = await setup({ listPins: vi.fn(async () => [pinRow('ana-2')]) });
      expect(api.listPins).not.toHaveBeenCalled();
      store.getState().openChat('ana@zilar.test');
      await flush();
      expect(api.listPins).toHaveBeenCalledWith('ana@zilar.test');
      expect(
        store
          .getState()
          .pins('ana@zilar.test')
          .map((pin) => pin.messageId),
      ).toEqual(['ana-2']);
      expect(store.getState().pinsLoaded('ana@zilar.test')).toBe(true);
    });

    it('refreshes pins on focus and every 60 s while the chat is open', async () => {
      vi.useFakeTimers();
      try {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        const api = fakeApi({ listPins: vi.fn(async () => [pinRow('ana-2')]) });
        const xmpp = fakeXmpp();
        xmpp.history['ana@zilar.test'] = [
          message({
            id: 'ana-1',
            chatJid: 'ana@zilar.test',
            body: 'older',
            timestamp: new Date('2026-09-28T09:00:00Z'),
          }),
          message({
            id: 'ana-2',
            chatJid: 'ana@zilar.test',
            body: 'newest',
            timestamp: new Date('2026-09-28T10:00:00Z'),
          }),
        ];
        const store = createRealChatStore({
          api,
          storage: memoryStorage(),
          now: () => new Date('2026-09-28T12:00:00Z'),
          createXmpp: () => xmpp.core,
        });
        store.getState().start();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);
        store.getState().openChat('ana@zilar.test');
        await vi.advanceTimersByTimeAsync(0);
        expect(api.listPins).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(0);
        expect(api.listPins).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(api.listPins).toHaveBeenCalledTimes(3);
        expect(store.getState().pins('ana@zilar.test')).toHaveLength(1);
        store.getState().stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it('pins and unpins optimistically, rolling back on failure', async () => {
      const saved = pinRow('ana-2');
      const { store, api } = await setup({
        listPins: vi.fn(async () => []),
        pinMessage: vi.fn(async () => saved),
        unpinMessage: vi.fn(async () => {}),
      });
      store.getState().openChat('ana@zilar.test');
      await flush();

      await store.getState().pinMessage('ana@zilar.test', 'ana-2');
      expect(api.pinMessage).toHaveBeenCalledWith({
        chat: 'ana@zilar.test',
        messageId: 'ana-2',
        senderName: 'Ana',
        text: 'newest',
        kind: 'text',
      });
      expect(
        store
          .getState()
          .pins('ana@zilar.test')
          .map((pin) => pin.id),
      ).toEqual([saved.id]);

      await store.getState().unpinMessage('ana@zilar.test', saved.id);
      expect(api.unpinMessage).toHaveBeenCalledWith(saved.id);
      expect(store.getState().pins('ana@zilar.test')).toEqual([]);

      // A failed pin rolls back and reports inline.
      vi.mocked(api.pinMessage).mockRejectedValueOnce(new Error('offline'));
      await expect(store.getState().pinMessage('ana@zilar.test', 'ana-1')).rejects.toThrow(
        'offline',
      );
      expect(store.getState().pins('ana@zilar.test')).toEqual([]);
      expect(store.getState().pinsError).toEqual({
        chatId: 'ana@zilar.test',
        message: 'Could not pin the message. Try again.',
      });
    });

    it('gates pinning: anyone in a DM, only managers in a topic', async () => {
      const { store } = await setup({
        listPins: vi.fn(async () => []),
        getGroup: vi.fn(async () => ({
          id: 'g1',
          title: 'Team',
          createdBy: 'u-me',
          members: [{ userId: 'u-me', name: 'Me', role: 'member' as const }],
          ais: [],
        })),
      });
      // DMs: either side may pin.
      expect(store.getState().canPin('ana@zilar.test')).toBe(true);
      // The legacy group row starts unknown (detail not loaded yet).
      expect(store.getState().canPin('team@rooms.zilar.test')).toBe(false);
      store.getState().openChat('team@rooms.zilar.test');
      await flush();
      // A plain member may not pin.
      expect(store.getState().canPin('team@rooms.zilar.test')).toBe(false);
    });
  });

  it('gives up with message_not_found when a history fetch stalls', async () => {
    const { store, xmpp } = await setup();
    vi.useFakeTimers();
    try {
      // The opening page never settles: openAtMessage must not hang forever.
      vi.mocked(xmpp.core.loadHistory).mockImplementationOnce(() => new Promise(() => {}));
      const pending = store.getState().openAtMessage('ana@zilar.test', 'ana-2');
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
            chatJid: 'new@rooms.zilar.test',
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
    expect(chatJid).toBe('new@rooms.zilar.test');
    expect(api.createGroup).toHaveBeenCalledWith({ title: 'New', memberIds: ['u-ana'] });
    expect(xmpp.core.joinRoom).toHaveBeenCalledWith('new@rooms.zilar.test', 'Me');
  });

  it('updates presence for a DM contact', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit('presence', { jid: 'ana@zilar.test', available: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.online).toBe(true);
    xmpp.emit('presence', { jid: 'ana@zilar.test', available: false });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.online).toBe(false);
  });

  it('returns the invite URL', async () => {
    const { store } = await setup();
    await expect(store.getState().createInvite()).resolves.toBe('http://x/invite/c');
  });

  it('refreshes the chat list after a channel role change so the composer bar flips', async () => {
    // T-0124: the composer bar reads `myRole` off the chat row. After a
    // promote, the row must carry the fresh role — the role write triggers
    // a list refresh that rebuilds the rows from server truth.
    const feed = {
      kind: 'group' as const,
      chatJid: 'acme@rooms.zilar.test',
      title: 'Acme Announcements',
      groupId: 'g-acme',
      memberCount: 3,
      role: 'member' as const,
      chatKind: 'channel' as const,
      subscriberCount: 3,
    };
    let calls = 0;
    const getChats = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? [feed] : [{ ...feed, role: 'admin' as const }];
    });
    const changeGroupMemberRole = vi.fn(async () => ({
      id: 'g-acme',
      title: 'Acme Announcements',
      createdBy: 'u-ana',
      kind: 'channel' as const,
      description: null,
      members: [
        { userId: 'u-me', name: 'Me', role: 'admin' as const, roles: [] },
        { userId: 'u-ana', name: 'Ana', role: 'owner' as const, roles: [] },
      ],
      ais: [],
    }));
    const { store } = await setup({ getChats, changeGroupMemberRole });
    expect(store.getState().chats.find((chat) => chat.id === 'acme@rooms.zilar.test')?.myRole).toBe(
      'member',
    );

    await store.getState().changeChannelRole('acme@rooms.zilar.test', 'u-me', 'admin');

    expect(changeGroupMemberRole).toHaveBeenCalledWith('g-acme', 'u-me', 'admin');
    expect(calls).toBeGreaterThan(1);
    expect(store.getState().chats.find((chat) => chat.id === 'acme@rooms.zilar.test')?.myRole).toBe(
      'admin',
    );
  });

  it('refreshes the chat list on an invitation and joins the new group room', async () => {
    const base = [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
    ];
    const invited = {
      kind: 'group' as const,
      chatJid: 'new@rooms.zilar.test',
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
      roomJid: 'new@rooms.zilar.test',
      fromJid: 'ana@zilar.test',
      reason: 'Join us',
    });
    await waitForRefresh();

    expect(store.getState().chats[0]?.id).toBe('new@rooms.zilar.test');
    expect(xmpp.core.joinRoom).toHaveBeenCalledWith('new@rooms.zilar.test', 'Me');
    expect(xmpp.core.loadHistory).toHaveBeenCalledWith('new@rooms.zilar.test', 'groupchat', {
      max: 1,
    });
  });

  it('refreshes the chat list on a roster push', async () => {
    const base = [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
    ];
    const added = [
      ...base,
      { kind: 'dm' as const, chatJid: 'carla@zilar.test', title: 'Carla', userId: 'u-carla' },
    ];
    let calls = 0;
    const getChats = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? base : added;
    });
    const { store, xmpp } = await setup({ getChats });

    xmpp.emit('roster', { jid: 'carla@zilar.test', subscription: 'both', name: 'Carla' });
    await waitForRefresh();

    expect(store.getState().chats[0]?.id).toBe('carla@zilar.test');
  });

  it('debounces repeated refresh events into a single refetch', async () => {
    const base = [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
    ];
    const getChats = vi.fn(async () => base);
    const { xmpp } = await setup({ getChats });
    getChats.mockClear();

    xmpp.emit('invited', { roomJid: 'new@rooms.zilar.test' });
    xmpp.emit('roster', { jid: 'carla@zilar.test', subscription: 'both' });
    xmpp.emit('invited', { roomJid: 'other@rooms.zilar.test' });
    await waitForRefresh();

    expect(getChats).toHaveBeenCalledTimes(1);
  });

  it('toggles my reaction, sends the set and shows the chip', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();

    store.getState().react('ana@zilar.test', 'ana-1', '👍');
    await flush();

    expect(xmpp.core.sendReactions).toHaveBeenCalledWith('ana@zilar.test', 'chat', 'ana-1', ['👍']);
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toEqual([{ emoji: '👍', count: 1, mine: true, reactors: ['You'] }]);

    store.getState().react('ana@zilar.test', 'ana-1', '👍');
    await flush();

    expect(xmpp.core.sendReactions).toHaveBeenLastCalledWith('ana@zilar.test', 'chat', 'ana-1', []);
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toBeUndefined();
  });

  it('reverts my optimistic reaction when the send fails', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();

    vi.mocked(xmpp.core.sendReactions).mockRejectedValueOnce(new Error('offline'));
    store.getState().react('ana@zilar.test', 'ana-1', '👍');
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toEqual([{ emoji: '👍', count: 1, mine: true, reactors: ['You'] }]);

    await flush();
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((m) => m.id === 'ana-1')?.reactions,
    ).toBeUndefined();
  });

  it('applies history reactions before and after the target message', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      reactionMessage({
        id: 'r-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        emojis: ['👍'],
        timestamp: new Date('2026-09-28T09:01:00Z'),
      }),
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      reactionMessage({
        id: 'r-2',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        emojis: ['👍', '❤️'],
        timestamp: new Date('2026-09-28T09:02:00Z'),
      }),
    ];

    store.getState().openChat('ana@zilar.test');
    await flush();

    const list = store.getState().messages('ana@zilar.test');
    expect(list.map((m) => m.id)).toEqual(['ana-1']);
    expect(list[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, reactors: ['Ana'] },
      { emoji: '❤️', count: 1, mine: false, reactors: ['Ana'] },
    ]);
  });

  it('applies a live reaction message without adding a bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();
    const before = store.getState().messages('ana@zilar.test').length;

    xmpp.emit(
      'message',
      reactionMessage({
        id: 'r-live',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        emojis: ['❤️'],
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const list = store.getState().messages('ana@zilar.test');
    expect(list).toHaveLength(before);
    expect(list.find((m) => m.id === 'ana-1')?.reactions).toEqual([
      { emoji: '❤️', count: 1, mine: false, reactors: ['Ana'] },
    ]);
    expect(store.getState().chats.find((c) => c.id === 'ana@zilar.test')?.lastMessage?.id).toBe(
      'ana-2',
    );
  });

  it('renders a message that carries both a body and reactions', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();
    const before = store.getState().messages('ana@zilar.test').length;

    xmpp.emit(
      'message',
      message({
        id: 'ana-3',
        chatJid: 'ana@zilar.test',
        body: 'text plus a reaction',
        timestamp: new Date('2026-09-28T12:07:00Z'),
        reactions: { targetId: 'ana-1', emojis: ['🎉'] },
      }),
    );

    const list = store.getState().messages('ana@zilar.test');
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
        chatJid: 'ana@zilar.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    history.push(
      reactionMessage({
        id: 'r-old',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-0',
        emojis: ['👍'],
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, 40)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = history;

    store.getState().openChat('ana@zilar.test');
    await flush();
    expect(store.getState().messages('ana@zilar.test')[0]?.id).toBe('ana-11');

    store.getState().loadOlder('ana@zilar.test');
    await flush();

    const first = store.getState().messages('ana@zilar.test')[0];
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
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    xmpp.emit(
      'message',
      reactionMessage({
        id: 'r-g',
        chatJid: 'team@rooms.zilar.test',
        targetId: 'team-1',
        emojis: ['👍'],
        fromJid: 'ana@zilar.test',
        fromNick: 'ana',
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    expect(store.getState().messages('team@rooms.zilar.test')[0]?.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false, reactors: ['Ana'] },
    ]);

    store.getState().react('team@rooms.zilar.test', 'team-1', '❤️');
    expect(xmpp.core.sendReactions).toHaveBeenCalledWith(
      'team@rooms.zilar.test',
      'groupchat',
      'team-1',
      ['❤️'],
    );
  });

  it('matches a reaction to my optimistic message through the id alias', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();

    store.getState().sendText('ana@zilar.test', 'hello');
    await flush();
    const local = store.getState().messages('ana@zilar.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic message was not stored');
    }
    expect(local).toBe('local-1');

    store.getState().react('ana@zilar.test', local, '👍');
    expect(xmpp.core.sendReactions).toHaveBeenCalledWith('ana@zilar.test', 'chat', 'srv-1', ['👍']);

    xmpp.emit(
      'message',
      message({
        id: 'srv-1',
        chatJid: 'ana@zilar.test',
        body: 'hello',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:06:00Z'),
      }),
    );
    await flush();

    const echoed = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'srv-1');
    expect(echoed?.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, reactors: ['You'] }]);
  });

  it('does not react to a message whose server id is not known yet', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();

    // The send never resolves, so the optimistic message keeps its local id
    // and has no server id to name: reacting must change nothing.
    vi.mocked(xmpp.core.sendMessage).mockImplementationOnce(
      () => new Promise<{ id: string }>(() => {}),
    );
    store.getState().sendText('ana@zilar.test', 'still sending');
    const local = store.getState().messages('ana@zilar.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic message was not stored');
    }
    expect(local.startsWith('local-')).toBe(true);

    store.getState().react('ana@zilar.test', local, '👍');

    expect(xmpp.core.sendReactions).not.toHaveBeenCalled();
    expect(store.getState().messages('ana@zilar.test').at(-1)?.reactions).toBeUndefined();
  });
});

describe('message edits and deletes (T-0061)', () => {
  it('edits my own message optimistically, sends the origin id and shows the new text', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();

    store.getState().sendText('ana@zilar.test', 'hello');
    await flush();
    const local = store.getState().messages('ana@zilar.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic message was not stored');
    }

    store.getState().editMessage('ana@zilar.test', local, 'hello there');

    // A correction names the original by its sender-generated id (srv-1 is what
    // sendMessage returned; xmpp-core's origin id).
    expect(xmpp.core.sendCorrection).toHaveBeenCalledWith(
      'ana@zilar.test',
      'chat',
      'srv-1',
      'hello there',
      undefined,
    );
    const edited = store.getState().messages('ana@zilar.test').at(-1);
    expect(edited?.text).toBe('hello there');
    expect(edited?.edited).toBe(true);
  });

  it('reverts an optimistic edit when the send fails', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        fromJid: 'me@zilar.test',
        outgoing: true,
        originId: 'origin-older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
    ];
    store.getState().openChat('ana@zilar.test');
    await flush();

    vi.mocked(xmpp.core.sendCorrection).mockRejectedValueOnce(new Error('offline'));
    store.getState().editMessage('ana@zilar.test', 'ana-1', 'changed');
    expect(store.getState().messages('ana@zilar.test')[0]?.text).toBe('changed');

    await flush();
    const reverted = store.getState().messages('ana@zilar.test')[0];
    expect(reverted?.text).toBe('older');
    expect(reverted?.edited).toBeUndefined();
    expect(store.getState().actionError?.message).toContain('Could not save the edit');
  });

  it('deletes for everyone in a DM by the origin id and shows a tombstone', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        fromJid: 'me@zilar.test',
        outgoing: true,
        originId: 'origin-older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
        reactions: { targetId: 'ana-1', emojis: ['👍'] },
      }),
      message({
        id: 'ana-2',
        chatJid: 'ana@zilar.test',
        body: 'newest',
        timestamp: new Date('2026-09-28T10:00:00Z'),
      }),
    ];
    store.getState().openChat('ana@zilar.test');
    await flush();

    store.getState().deleteForEveryone('ana@zilar.test', 'ana-1');
    expect(xmpp.core.sendRetraction).toHaveBeenCalledWith('ana@zilar.test', 'chat', 'origin-older');
    const deleted = store.getState().messages('ana@zilar.test')[0];
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.text).toBeUndefined();
    expect(deleted?.reactions).toBeUndefined();
  });

  it('reverts an optimistic delete, restoring text and reactions', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        fromJid: 'me@zilar.test',
        outgoing: true,
        originId: 'origin-older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
        reactions: { targetId: 'ana-1', emojis: ['👍'] },
      }),
    ];
    store.getState().openChat('ana@zilar.test');
    await flush();

    vi.mocked(xmpp.core.sendRetraction).mockRejectedValueOnce(new Error('offline'));
    store.getState().deleteForEveryone('ana@zilar.test', 'ana-1');
    expect(store.getState().messages('ana@zilar.test')[0]?.deleted).toBe(true);

    await flush();
    const reverted = store.getState().messages('ana@zilar.test')[0];
    expect(reverted?.deleted).toBeUndefined();
    expect(reverted?.text).toBe('older');
    expect(store.getState().actionError?.message).toContain('Could not delete');
  });

  it('applies a live correction without adding a bubble', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();
    const before = store.getState().messages('ana@zilar.test').length;

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        text: 'corrected live',
        fromJid: 'ana@zilar.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const list = store.getState().messages('ana@zilar.test');
    expect(list).toHaveLength(before);
    const target = list.find((m) => m.id === 'ana-1');
    expect(target?.text).toBe('corrected live');
    expect(target?.edited).toBe(true);
  });

  it('resolves a correction that names the origin id of a message stored under its stanza-id', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'stanza-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        fromJid: 'ana@zilar.test',
        originId: 'origin-1',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
    ];
    store.getState().openChat('ana@zilar.test');
    await flush();

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@zilar.test',
        targetId: 'origin-1',
        text: 'matched by origin',
        fromJid: 'ana@zilar.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const target = store.getState().messages('ana@zilar.test')[0];
    expect(target?.id).toBe('stanza-1');
    expect(target?.text).toBe('matched by origin');
    expect(target?.edited).toBe(true);
  });

  it('applies a live retraction, stripping the message and leaving its place', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();
    const before = store.getState().messages('ana@zilar.test').length;

    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        fromJid: 'ana@zilar.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );

    const list = store.getState().messages('ana@zilar.test');
    expect(list).toHaveLength(before);
    const target = list.find((m) => m.id === 'ana-1');
    expect(target?.deleted).toBe(true);
    expect(target?.text).toBeUndefined();
  });

  it('ignores a correction or retraction from a foreign sender', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat('ana@zilar.test');
    await flush();

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        text: 'hijacked',
        fromJid: 'luis@zilar.test',
        timestamp: new Date('2026-09-28T12:05:00Z'),
      }),
    );
    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-2',
        fromJid: 'luis@zilar.test',
        timestamp: new Date('2026-09-28T12:06:00Z'),
      }),
    );

    const list = store.getState().messages('ana@zilar.test');
    expect(list.find((m) => m.id === 'ana-1')?.text).toBe('older');
    expect(list.find((m) => m.id === 'ana-2')?.deleted).toBeUndefined();
  });

  it('applies history edits before and after the target', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        text: 'corrected twice',
        fromJid: 'ana@zilar.test',
        timestamp: new Date('2026-09-28T09:00:30Z'),
      }),
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-2',
        fromJid: 'ana@zilar.test',
        timestamp: new Date('2026-09-28T10:00:30Z'),
      }),
      message({
        id: 'ana-2',
        chatJid: 'ana@zilar.test',
        body: 'newest',
        timestamp: new Date('2026-09-28T10:00:00Z'),
      }),
    ];

    store.getState().openChat('ana@zilar.test');
    await flush();

    const list = store.getState().messages('ana@zilar.test');
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
        chatJid: 'ana@zilar.test',
        body: `msg ${index}`,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    history.push(
      correctionMessage({
        id: 'c-old',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-0',
        text: 'fixed later',
        fromJid: 'ana@zilar.test',
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, 40)),
      }),
    );
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = history;

    store.getState().openChat('ana@zilar.test');
    await flush();
    expect(store.getState().messages('ana@zilar.test')[0]?.id).toBe('ana-11');

    store.getState().loadOlder('ana@zilar.test');
    await flush();

    const first = store.getState().messages('ana@zilar.test')[0];
    expect(first?.id).toBe('ana-0');
    expect(first?.text).toBe('fixed later');
    expect(first?.edited).toBe(true);
  });

  it('updates the preview and reply quotes for edits and deletes', async () => {
    const { store, xmpp } = await setup();
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'older',
        fromJid: 'me@zilar.test',
        outgoing: true,
        originId: 'origin-1',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
      message({
        id: 'ana-2',
        chatJid: 'ana@zilar.test',
        body: 'reply to older',
        timestamp: new Date('2026-09-28T10:00:00Z'),
        replyTo: { id: 'ana-1' },
      }),
      message({
        id: 'ana-3',
        chatJid: 'ana@zilar.test',
        body: 'reply to the reply',
        fromJid: 'me@zilar.test',
        outgoing: true,
        originId: 'origin-3',
        timestamp: new Date('2026-09-28T11:00:00Z'),
        replyTo: { id: 'ana-2' },
      }),
    ];
    store.getState().openChat('ana@zilar.test');
    await flush();

    xmpp.emit(
      'message',
      correctionMessage({
        id: 'c-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-1',
        text: 'corrected preview',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:00:00Z'),
      }),
    );

    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((m) => m.id === 'ana-2')?.replyTo?.text,
    ).toBe('corrected preview');

    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-1',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-2',
        timestamp: new Date('2026-09-28T12:01:00Z'),
      }),
    );

    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((m) => m.id === 'ana-3')?.replyTo?.text,
    ).toBe('Deleted message');

    xmpp.emit(
      'message',
      retractionMessage({
        id: 'r-2',
        chatJid: 'ana@zilar.test',
        targetId: 'ana-3',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    expect(store.getState().chats.find((c) => c.id === 'ana@zilar.test')?.lastMessage?.text).toBe(
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
    store.getState().openChat('team@rooms.zilar.test');
    await flush();

    store.getState().sendText('team@rooms.zilar.test', 'hello room');
    await flush();

    const local = store.getState().messages('team@rooms.zilar.test').at(-1)?.id;
    if (local === undefined) {
      throw new Error('the optimistic group message was not stored');
    }

    // The MUC echo assigns the stanza-id that a group retraction must name.
    xmpp.emit(
      'message',
      message({
        id: 'sid-1',
        chatJid: 'team@rooms.zilar.test',
        body: 'hello room',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:06:00Z'),
      }),
    );
    await flush();

    store.getState().deleteForEveryone('team@rooms.zilar.test', local);
    expect(xmpp.core.sendRetraction).toHaveBeenCalledWith(
      'team@rooms.zilar.test',
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
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'ana-1',
        chatJid: 'ana@zilar.test',
        body: 'hello before ready',
        timestamp: new Date('2026-09-28T09:00:00Z'),
      }),
    ];
    xmpp.history['team@rooms.zilar.test'] = [
      message({
        id: 'team-1',
        chatJid: 'team@rooms.zilar.test',
        body: 'group hello',
        fromJid: 'ana@zilar.test',
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

    expect(store.getState().chats.map((chat) => chat.id)).toContain('ana@zilar.test');
  });

  it('goes loading -> error -> retry -> ready when /api/chats fails first', async () => {
    const chats = [
      { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
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
    expect(store.getState().chats.map((chat) => chat.id)).toEqual(['ana@zilar.test']);
  });

  it('loads history for a chat opened before the core and chats are ready', async () => {
    const { store, xmpp } = unstartedStore();

    store.getState().openChat('ana@zilar.test');
    store.getState().start();
    await waitForState(() => store.getState().messages('ana@zilar.test').length > 0);

    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .map((item) => item.text),
    ).toContain('hello before ready');
    expect(pageLoads(xmpp, 'ana@zilar.test')).toBe(1);
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
    store.getState().openChat('ana@zilar.test');
    await flush();
    expect(pageLoads(xmpp, 'ana@zilar.test')).toBe(0);
    expect(store.getState().historyState['ana@zilar.test']).toBe('loading');

    finishConnect();
    await waitForState(() => store.getState().historyState['ana@zilar.test'] === 'ready');
    expect(pageLoads(xmpp, 'ana@zilar.test')).toBe(1);
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

    store.getState().openChat('team@rooms.zilar.test');
    store.getState().start();
    await waitForState(() => store.getState().status === 'online');
    await flush();
    expect(pageLoads(xmpp, 'team@rooms.zilar.test')).toBe(0);

    finishJoin();
    await waitForState(() => store.getState().historyState['team@rooms.zilar.test'] === 'ready');
    expect(pageLoads(xmpp, 'team@rooms.zilar.test')).toBe(1);
  });

  it('only the latest pending chat loads', async () => {
    const { store, xmpp } = unstartedStore();

    store.getState().openChat('ana@zilar.test');
    store.getState().openChat('team@rooms.zilar.test');
    store.getState().start();
    await waitForState(() => store.getState().messages('team@rooms.zilar.test').length > 0);
    await flush();

    expect(pageLoads(xmpp, 'team@rooms.zilar.test')).toBe(1);
    expect(pageLoads(xmpp, 'ana@zilar.test')).toBe(0);
  });

  it('does not load the same chat history twice', async () => {
    const { store, xmpp } = await setup();

    store.getState().openChat('ana@zilar.test');
    store.getState().openChat('ana@zilar.test');
    await waitForState(() => store.getState().messages('ana@zilar.test').length > 0);
    await flush();

    expect(pageLoads(xmpp, 'ana@zilar.test')).toBe(1);
  });

  it('marks per-chat history loading, then ready', async () => {
    const { store } = unstartedStore();

    store.getState().openChat('ana@zilar.test');
    expect(store.getState().historyState['ana@zilar.test']).toBe('loading');

    store.getState().start();
    await waitForState(() => store.getState().historyState['ana@zilar.test'] === 'ready');
  });

  it('marks per-chat history error when the page load fails', async () => {
    const { store, xmpp } = await setup();
    vi.mocked(xmpp.core.loadHistory).mockRejectedValueOnce(new Error('mam failed'));

    store.getState().openChat('ana@zilar.test');
    await waitForState(() => store.getState().historyState['ana@zilar.test'] === 'error');
  });

  it('clears the loading marker of a superseded pending chat', async () => {
    const { store, xmpp } = unstartedStore();

    store.getState().openChat('ana@zilar.test');
    expect(store.getState().historyState['ana@zilar.test']).toBe('loading');

    store.getState().openChat('team@rooms.zilar.test');
    expect(store.getState().historyState['ana@zilar.test']).toBeUndefined();
    expect(store.getState().historyState['team@rooms.zilar.test']).toBe('loading');

    store.getState().start();
    await waitForState(() => store.getState().messages('team@rooms.zilar.test').length > 0);
    expect(pageLoads(xmpp, 'team@rooms.zilar.test')).toBe(1);
    expect(pageLoads(xmpp, 'ana@zilar.test')).toBe(0);
  });
});

describe('AI reply drafts (T-0043)', () => {
  const CHAT = 'ana@zilar.test';
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
        fromJid: 'me@zilar.test',
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
    const goToLogin = vi.fn();
    const { store, xmpp } = await setup({}, undefined, { openDrafts: drafts.open, goToLogin });
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

    await store.getState().signOut();
    expect(goToLogin).toHaveBeenCalledTimes(1);
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
    const goToLogin = vi.fn();
    const { store } = await setup({}, undefined, { openDrafts: drafts.open, goToLogin });
    await store.getState().signOut();

    expect(drafts.close).toHaveBeenCalledTimes(1);
    expect(store.getState().drafts).toEqual({});
    expect(goToLogin).toHaveBeenCalledTimes(1);
  });

  it('forgets the cached server-owner answer on signOut', async () => {
    const { store } = await setup({}, undefined, { goToLogin: vi.fn() });
    vi.mocked(resetIsServerOwnerCache).mockClear();
    await store.getState().signOut();

    expect(resetIsServerOwnerCache).toHaveBeenCalledTimes(1);
  });
});

describe('attachments (T-0065)', () => {
  function fakeAttachments(overrides: Partial<AttachmentPort> = {}): AttachmentPort {
    return {
      classify: () => 'image',
      readImageSize: vi.fn(async () => ({ width: 800, height: 600 })),
      upload: vi.fn(async () => 'http://upload.zilar.test/get/1/photo.png'),
      ...overrides,
    };
  }

  function imageFile(): File {
    return new File(['abcd'], 'photo.png', { type: 'image/png' });
  }

  it('shows an optimistic image at once, then sends the payload with the upload', async () => {
    const attachments = fakeAttachments();
    const { store, xmpp } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@zilar.test', imageFile(), { caption: 'the stage' });

    const optimistic = store.getState().messages('ana@zilar.test').at(-1);
    expect(optimistic?.attachment?.kind).toBe('image');
    expect(optimistic?.attachment?.name).toBe('photo.png');
    expect(optimistic?.text).toBe('the stage');
    expect(optimistic?.status).toBe('sending');

    await flush();

    expect(attachments.upload).toHaveBeenCalledTimes(1);
    expect(xmpp.core.sendMessage).toHaveBeenCalledWith('ana@zilar.test', 'chat', 'the stage', {
      payload: {
        v: 0,
        type: 'attachment',
        data: {
          kind: 'image',
          url: 'http://upload.zilar.test/get/1/photo.png',
          name: 'photo.png',
          size: 4,
          mime: 'image/png',
          width: 800,
          height: 600,
        },
      },
    });
    const sent = store.getState().messages('ana@zilar.test').at(-1);
    expect(sent?.attachment?.url).toBe('http://upload.zilar.test/get/1/photo.png');
    expect(sent?.status).toBe('sent');
  });

  it('marks a failed upload failed and retries it from the kept file', async () => {
    let attempt = 0;
    const upload = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new AttachmentError('upload_failed', 'nope');
      }
      return 'http://upload.zilar.test/get/1/photo.png';
    });
    const attachments = fakeAttachments({ upload });
    const { store } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@zilar.test', imageFile(), { caption: 'retry me' });
    await flush();

    const failed = store.getState().messages('ana@zilar.test').at(-1);
    expect(failed?.failed).toBe(true);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('upload_refused');
    expect(failed?.attachment?.url).toBe('');

    store.getState().retryAttachment('ana@zilar.test', failed?.id ?? '');
    expect(store.getState().messages('ana@zilar.test').at(-1)?.failed).toBeUndefined();
    expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('sending');

    await flush();

    const retried = store.getState().messages('ana@zilar.test').at(-1);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(retried?.failed).toBeUndefined();
    expect(retried?.status).toBe('sent');
    expect(retried?.attachment?.url).toBe('http://upload.zilar.test/get/1/photo.png');
  });

  it('carries the reply target on the sent payload', async () => {
    const attachments = fakeAttachments();
    const { store, xmpp } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@zilar.test', imageFile(), {
      caption: 'look',
      replyTo: { id: 'ana-2', senderName: 'Ana', text: 'newest' },
    });
    await flush();

    expect(xmpp.core.sendMessage).toHaveBeenCalledWith(
      'ana@zilar.test',
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
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'file',
            url: 'http://upload.zilar.test/get/1/plan.pdf',
            name: 'plan.pdf',
            size: 2048,
            mime: 'application/pdf',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
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
        chatJid: 'ana@zilar.test',
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
      .messages('ana@zilar.test')
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
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'voice',
          data: {
            duration_ms: 1000,
            mime: 'audio/mp4',
            waveform: [10, 20],
            url: 'https://upload.zilar.test/upload/abc/voice.m4a',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'voice-trusted');
    expect(incoming?.voice?.url).toBe('https://upload.zilar.test/upload/abc/voice.m4a');
  });

  it('drops the audio URL of an incoming voice message on an untrusted host', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'voice-untrusted',
        chatJid: 'ana@zilar.test',
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
      .messages('ana@zilar.test')
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
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://upload.zilar.test/upload/abc/stage.png',
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
      .messages('ana@zilar.test')
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
        chatJid: 'ana@zilar.test',
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
      .messages('ana@zilar.test')
      .find((m) => m.id === 'att-untrusted');
    expect(incoming?.attachment?.kind).toBe('file');
    // Width/height must not leak through, otherwise the bubble would still
    // reserve image-sized space before the user clicks the card.
    expect(incoming?.attachment?.width).toBeUndefined();
    expect(incoming?.attachment?.height).toBeUndefined();
    expect(incoming?.attachment?.url).toBe('https://tracker.example.com/pixel.png');
    // An ordinary image name is not a GIF-video alias: the prefix rule
    // leaves it alone.
    expect(incoming?.attachment?.name).toBe('pixel.png');
  });

  it('strips the gif- prefix when the image downgrade branch fires on a GIF-video shape', async () => {
    // The exact shape from the spec: kind `image`, a `gif-` name, a video
    // mime, an untrusted URL. The sanitizer downgrades to `file` and must
    // also strip the prefix, so the render-layer URL check is not the only
    // guard — either layer alone stops the auto-play.
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-gif-image-kind',
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://attacker.test/x.mp4',
            name: 'gif-x',
            size: 1024,
            mime: 'video/mp4',
            width: 200,
            height: 150,
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'att-gif-image-kind');
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment?.name).toBe('x');
    expect(incoming?.attachment?.url).toBe('https://attacker.test/x.mp4');
    expect(incoming?.attachment?.width).toBeUndefined();
    expect(incoming?.attachment?.height).toBeUndefined();
  });

  it('keeps an incoming file attachment on an untrusted host as a file', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-file-untrusted',
        chatJid: 'ana@zilar.test',
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
      .messages('ana@zilar.test')
      .find((m) => m.id === 'att-file-untrusted');
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment?.url).toBe('https://files.example.com/random.bin');
  });

  it('strips the gif- prefix of an incoming GIF-video on an untrusted host', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-gif-untrusted',
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'file',
            url: 'https://attacker.test/x.mp4',
            name: 'gif-x',
            size: 1024,
            mime: 'video/mp4',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'att-gif-untrusted');
    // The rename breaks the inline-video match, so the bubble renders a
    // click-to-load file card; the download link keeps working.
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment?.name).toBe('x');
    expect(incoming?.attachment?.url).toBe('https://attacker.test/x.mp4');
  });

  it('keeps the gif- prefix of an incoming GIF-video on the trusted upload host', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'att-gif-trusted',
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'file',
            url: 'https://upload.zilar.test/get/1/gif-abc.mp4',
            name: 'gif-abc',
            size: 1024,
            mime: 'video/mp4',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'att-gif-trusted');
    expect(incoming?.attachment?.kind).toBe('file');
    expect(incoming?.attachment?.name).toBe('gif-abc');
    expect(incoming?.attachment?.url).toBe('https://upload.zilar.test/get/1/gif-abc.mp4');
  });

  it('maps history attachments through the same trusted-host check', async () => {
    const xmpp = fakeXmpp();
    xmpp.history['ana@zilar.test'] = [
      message({
        id: 'att-history-trusted',
        chatJid: 'ana@zilar.test',
        body: '',
        payload: {
          v: 0,
          type: 'attachment',
          data: {
            kind: 'image',
            url: 'https://upload.zilar.test/upload/abc/photo.png',
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
        chatJid: 'ana@zilar.test',
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
    store.getState().openChat('ana@zilar.test');
    await flush();

    const list = store.getState().messages('ana@zilar.test');
    const trusted = list.find((m) => m.id === 'att-history-trusted');
    const untrusted = list.find((m) => m.id === 'att-history-untrusted');
    expect(trusted?.attachment?.kind).toBe('image');
    expect(untrusted?.attachment?.kind).toBe('file');
    expect(untrusted?.attachment?.width).toBeUndefined();
    expect(untrusted?.attachment?.height).toBeUndefined();
  });
});

describe('forwarded messages (T-0409)', () => {
  it('keeps the forward origin on an incoming message', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'fwd-in',
        chatJid: 'ana@zilar.test',
        body: 'hello there',
        forward: {
          sender_id: 'luis@zilar.test',
          sender_name: 'Luis',
          chat_id: 'c-viernes@conference.zilar.test',
          chat_name: 'Friday plans',
          original_at: '2026-08-30T18:00:00.000Z',
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'fwd-in');
    expect(incoming?.forward).toEqual({
      sender_id: 'luis@zilar.test',
      sender_name: 'Luis',
      chat_id: 'c-viernes@conference.zilar.test',
      chat_name: 'Friday plans',
      original_at: '2026-08-30T18:00:00.000Z',
    });
  });
});

describe('stickers (T-0120)', () => {
  const stickerInput = {
    stickerId: '223e4567-e89b-12d3-a456-426614174001',
    packId: '123e4567-e89b-12d3-a456-426614174000',
    url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
    emoji: '🐱',
    width: 200,
    height: 200,
    mime: 'image/webp' as const,
  };

  it('sends the sticker payload shape over XMPP with the emoji body', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendSticker('ana@zilar.test', stickerInput);
    await flush();

    expect(xmpp.core.sendMessage).toHaveBeenCalledWith('ana@zilar.test', 'chat', '🐱', {
      payload: {
        v: 0,
        type: 'sticker',
        data: {
          pack_id: '123e4567-e89b-12d3-a456-426614174000',
          sticker_id: '223e4567-e89b-12d3-a456-426614174001',
          url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
          emoji: '🐱',
          width: 200,
          height: 200,
          mime: 'image/webp',
        },
      },
    });
    const sent = store.getState().messages('ana@zilar.test').at(-1);
    expect(sent?.card).toEqual({
      v: 0,
      type: 'sticker',
      data: {
        pack_id: '123e4567-e89b-12d3-a456-426614174000',
        sticker_id: '223e4567-e89b-12d3-a456-426614174001',
        url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
        emoji: '🐱',
        width: 200,
        height: 200,
        mime: 'image/webp',
      },
    });
    expect(sent?.status).toBe('sent');
  });

  it('marks a failed sticker send failed and retries it', async () => {
    const { store, xmpp } = await setup();
    vi.mocked(xmpp.core.sendMessage).mockRejectedValueOnce(new Error('offline'));

    store.getState().sendSticker('ana@zilar.test', stickerInput);
    await flush();

    const failed = store.getState().messages('ana@zilar.test').at(-1);
    expect(failed?.failed).toBe(true);
    expect(failed?.status).toBe('sending');

    store.getState().retrySticker('ana@zilar.test', failed?.id ?? '');
    expect(store.getState().messages('ana@zilar.test').at(-1)?.failed).toBeUndefined();
    await flush();

    const retried = store.getState().messages('ana@zilar.test').at(-1);
    expect(xmpp.core.sendMessage).toHaveBeenCalledTimes(2);
    expect(retried?.failed).toBeUndefined();
    expect(retried?.status).toBe('sent');
  });

  it('maps an incoming sticker payload onto the card', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit(
      'message',
      message({
        id: 'st-in',
        chatJid: 'ana@zilar.test',
        body: '🐱',
        payload: {
          v: 0,
          type: 'sticker',
          data: {
            pack_id: '123e4567-e89b-12d3-a456-426614174000',
            sticker_id: '223e4567-e89b-12d3-a456-426614174001',
            url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
            emoji: '🐱',
            width: 200,
            height: 200,
            mime: 'image/webp',
          },
        },
      }),
    );

    const incoming = store
      .getState()
      .messages('ana@zilar.test')
      .find((m) => m.id === 'st-in');
    expect(incoming?.card).toEqual({
      v: 0,
      type: 'sticker',
      data: {
        pack_id: '123e4567-e89b-12d3-a456-426614174000',
        sticker_id: '223e4567-e89b-12d3-a456-426614174001',
        url: '/api/stickers/223e4567-e89b-12d3-a456-426614174001/file',
        emoji: '🐱',
        width: 200,
        height: 200,
        mime: 'image/webp',
      },
    });
  });

  it('refuses a hostile sticker without leaving a sending bubble', async () => {
    // A tampered recents entry (non-uuid ids): `encodePayload` would throw
    // synchronously, so the send must refuse with a visible error and no
    // bubble — never a stuck `sending` message.
    const { store, xmpp } = await setup();
    const before = store.getState().messages('ana@zilar.test').length;

    store.getState().sendSticker('ana@zilar.test', {
      ...stickerInput,
      stickerId: 'not-a-uuid',
      packId: 'also-not-a-uuid',
    });
    await flush();

    expect(xmpp.core.sendMessage).not.toHaveBeenCalled();
    expect(store.getState().messages('ana@zilar.test')).toHaveLength(before);
    expect(store.getState().actionError).toEqual({
      chatId: 'ana@zilar.test',
      message: 'That sticker could not be sent.',
    });
  });

  it('links each echo to the right sticker when two share one emoji', async () => {
    const { store, xmpp } = await setup();
    const second = { ...stickerInput, stickerId: '323e4567-e89b-12d3-a456-426614174002' };

    store.getState().sendSticker('ana@zilar.test', stickerInput);
    store.getState().sendSticker('ana@zilar.test', second);
    await flush();

    const sent = store.getState().messages('ana@zilar.test').slice(-2);
    expect(sent).toHaveLength(2);
    const [firstLocal, secondLocal] = sent.map((m) => m.id);

    // Echoes arrive swapped: each must still resolve its own optimistic id.
    const secondData = {
      pack_id: second.packId,
      sticker_id: second.stickerId,
      url: second.url,
      emoji: second.emoji,
      width: second.width,
      height: second.height,
      mime: second.mime,
    };
    const firstData = {
      pack_id: stickerInput.packId,
      sticker_id: stickerInput.stickerId,
      url: stickerInput.url,
      emoji: stickerInput.emoji,
      width: stickerInput.width,
      height: stickerInput.height,
      mime: stickerInput.mime,
    };
    xmpp.emit(
      'message',
      message({
        id: 'srv-second',
        chatJid: 'ana@zilar.test',
        body: '🐱',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:00:01Z'),
        payload: { v: 0, type: 'sticker', data: secondData },
      }),
    );
    xmpp.emit(
      'message',
      message({
        id: 'srv-first',
        chatJid: 'ana@zilar.test',
        body: '🐱',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:00:02Z'),
        payload: { v: 0, type: 'sticker', data: firstData },
      }),
    );

    const list = store.getState().messages('ana@zilar.test');
    expect(list.some((m) => m.id === firstLocal)).toBe(false);
    expect(list.some((m) => m.id === secondLocal)).toBe(false);
    const firstEcho = list.find((m) => m.id === 'srv-first');
    const secondEcho = list.find((m) => m.id === 'srv-second');
    expect(firstEcho?.card).toMatchObject({ type: 'sticker' });
    expect(secondEcho?.card).toMatchObject({ type: 'sticker' });
    if (firstEcho?.card?.type === 'sticker' && secondEcho?.card?.type === 'sticker') {
      expect(firstEcho.card.data.sticker_id).toBe(stickerInput.stickerId);
      expect(secondEcho.card.data.sticker_id).toBe(second.stickerId);
    }
  });
});

describe('send failure state (T-0168)', () => {
  function voiceRecording(): { blob: Blob; durationMs: number; waveform: number[] } {
    return {
      blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }),
      durationMs: 1200,
      waveform: [10, 20, 30],
    };
  }

  function imageFile(): File {
    return new File(['abcd'], 'photo.png', { type: 'image/png' });
  }

  function fakeAttachments(overrides: Partial<AttachmentPort> = {}): AttachmentPort {
    return {
      classify: () => 'image',
      readImageSize: vi.fn(async () => ({ width: 800, height: 600 })),
      upload: vi.fn(async () => 'http://upload.zilar.test/get/1/photo.png'),
      ...overrides,
    };
  }

  function fakeVoice(
    overrides: Partial<NonNullable<RealStoreDeps['voice']>> = {},
  ): NonNullable<RealStoreDeps['voice']> {
    return {
      convert: vi.fn(async () => ({
        audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
        durationMs: 4321,
      })),
      upload: vi.fn(async () => 'http://upload.zilar.test/get/1/voice.m4a'),
      ...overrides,
    };
  }

  it('maps errors to fixed user-safe reasons and never leaks raw text', () => {
    expect(sendFailureReasonFor(new AttachmentError('too_large', 'x'), false)).toBe('too_large');
    expect(sendFailureReasonFor(new VoiceError('voice_too_large', 'x'), false)).toBe('too_large');
    expect(sendFailureReasonFor(new AttachmentError('upload_failed', 'x'), false)).toBe(
      'upload_refused',
    );
    expect(sendFailureReasonFor(new VoiceError('voice_failed', 'x'), false)).toBe(
      'server_unavailable',
    );
    expect(sendFailureReasonFor(new VoiceError('network_error', 'x'), false)).toBe('network');
    expect(sendFailureReasonFor(new Error('anything'), true)).toBe('network');
    expect(sendFailureReasonFor(new Error('boom'), false)).toBe('network');
  });

  it('a voice conversion failure ends failed with a reason and keeps the local audio', async () => {
    const rawMessage = 'ffmpeg exploded: secret-token http://internal/token';
    const voice = fakeVoice({
      convert: vi.fn(async () => {
        throw new VoiceError('voice_failed', rawMessage);
      }),
    });
    const { store } = await setup({}, voice);

    store.getState().sendVoice('ana@zilar.test', voiceRecording());
    await flush();

    const failed = store.getState().messages('ana@zilar.test').at(-1);
    expect(failed?.status).toBe('failed');
    expect(failed?.failed).toBe(true);
    expect(failed?.failureReason).toBe('server_unavailable');
    // The optimistic bubble keeps its local audio for the retry.
    expect(failed?.voice?.duration_ms).toBe(1200);
    expect(failed?.voice?.waveform).toEqual([10, 20, 30]);
    // No raw error text, URL or token reaches the stored message.
    expect(JSON.stringify(failed)).not.toContain('ffmpeg exploded');
    expect(JSON.stringify(failed)).not.toContain('secret-token');
    // The chat list preview agrees with the bubble.
    expect(
      store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.lastMessage?.status,
    ).toBe('failed');
  });

  it('a voice upload failure ends failed as upload_refused', async () => {
    const voice = fakeVoice({
      upload: vi.fn(async () => {
        throw new VoiceError('upload_failed', 'slot refused: http://upload/put?token=abc');
      }),
    });
    const { store } = await setup({}, voice);

    store.getState().sendVoice('ana@zilar.test', voiceRecording());
    await flush();

    const failed = store.getState().messages('ana@zilar.test').at(-1);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('upload_refused');
    expect(JSON.stringify(failed)).not.toContain('token=abc');
  });

  it('a voice final-send failure ends failed and retry sends it', async () => {
    let attempt = 0;
    const voice = fakeVoice();
    const { store, xmpp } = await setup({}, voice);
    vi.mocked(xmpp.core.sendMessage).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('the XMPP connection is not online');
      }
      return { id: 'srv-voice' };
    });

    store.getState().sendVoice('ana@zilar.test', voiceRecording());
    await flush();

    const failed = store.getState().messages('ana@zilar.test').at(-1);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('network');

    store.getState().retryVoice('ana@zilar.test', failed?.id ?? '');
    expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('sending');
    await flush();

    const retried = store.getState().messages('ana@zilar.test').at(-1);
    expect(retried?.status).toBe('sent');
    expect(retried?.failed).toBeUndefined();
    expect(retried?.failureReason).toBeUndefined();
    expect(retried?.voice?.url).toBe('http://upload.zilar.test/get/1/voice.m4a');
  });

  it('retry after the cause is fixed converts again and sends', async () => {
    let attempt = 0;
    const convert = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new VoiceError('voice_failed', 'no ffmpeg on this image');
      }
      return {
        audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
        durationMs: 4321,
      };
    });
    const { store } = await setup({}, fakeVoice({ convert }));

    store.getState().sendVoice('ana@zilar.test', voiceRecording());
    await flush();
    expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('failed');

    store
      .getState()
      .retryVoice('ana@zilar.test', store.getState().messages('ana@zilar.test').at(-1)?.id ?? '');
    await flush();

    expect(convert).toHaveBeenCalledTimes(2);
    const retried = store.getState().messages('ana@zilar.test').at(-1);
    expect(retried?.status).toBe('sent');
    expect(retried?.voice?.duration_ms).toBe(4321);
  });

  it('delete removes the failed bubble and its kept bytes', async () => {
    const convert = vi.fn(async (): Promise<{ audio: Blob; durationMs: number }> => {
      throw new VoiceError('voice_failed', 'nope');
    });
    const voice = fakeVoice({ convert });
    const { store } = await setup({}, voice);

    store.getState().sendVoice('ana@zilar.test', voiceRecording());
    await flush();
    const before = store.getState().messages('ana@zilar.test').length;
    const failedId = store.getState().messages('ana@zilar.test').at(-1)?.id ?? '';
    expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('failed');

    store.getState().deleteFailedMessage('ana@zilar.test', failedId);
    expect(
      store
        .getState()
        .messages('ana@zilar.test')
        .find((item) => item.id === failedId),
    ).toBeUndefined();
    expect(store.getState().messages('ana@zilar.test')).toHaveLength(before - 1);

    // The bytes went with the bubble: a retry after delete is a no-op.
    store.getState().retryVoice('ana@zilar.test', failedId);
    expect(voice.convert).toHaveBeenCalledTimes(1);
  });

  it('a stale pipeline result is ignored once a retry owns the message', async () => {
    // Finding 2: the send hangs, the timeout fires, the user retries, and only
    // then does the ORIGINAL pipeline reject. The stale failure must not flip
    // the bubble the retry owns; when the retry succeeds it ends `sent`.
    vi.useFakeTimers();
    try {
      const api = fakeApi();
      const xmpp = fakeXmpp();
      xmpp.history['ana@zilar.test'] = [
        message({
          id: 'ana-1',
          chatJid: 'ana@zilar.test',
          body: 'older',
          timestamp: new Date('2026-09-28T09:00:00Z'),
        }),
      ];
      let releaseOriginal!: (error: unknown) => void;
      const gate = new Promise<{ audio: Blob; durationMs: number }>((_resolve, reject) => {
        releaseOriginal = reject;
      });
      let releaseRetry!: (value: { audio: Blob; durationMs: number }) => void;
      const retryGate = new Promise<{ audio: Blob; durationMs: number }>((resolve) => {
        releaseRetry = resolve;
      });
      let attempt = 0;
      const convert = vi.fn(async (): Promise<{ audio: Blob; durationMs: number }> => {
        attempt += 1;
        if (attempt === 1) {
          return gate;
        }
        return retryGate;
      });
      const store = createRealChatStore({
        api,
        storage: memoryStorage(),
        now: () => new Date('2026-09-28T12:00:00Z'),
        createXmpp: () => xmpp.core,
        voice: fakeVoice({ convert }),
      });
      store.getState().start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      store.getState().sendVoice('ana@zilar.test', voiceRecording());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('failed');

      // Retry while the original pipeline is still hung.
      store
        .getState()
        .retryVoice('ana@zilar.test', store.getState().messages('ana@zilar.test').at(-1)?.id ?? '');
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('sending');

      // The original pipeline now rejects: ignored, the retry still owns it.
      releaseOriginal(new Error('the stalled convert finally failed'));
      await vi.advanceTimersByTimeAsync(0);
      const during = store.getState().messages('ana@zilar.test').at(-1);
      expect(during?.status).toBe('sending');

      // The retry's own pipeline succeeds.
      releaseRetry({
        audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
        durationMs: 4321,
      });
      await vi.advanceTimersByTimeAsync(0);
      const retried = store.getState().messages('ana@zilar.test').at(-1);
      expect(convert).toHaveBeenCalledTimes(2);
      expect(retried?.status).toBe('sent');
      expect(retried?.failed).toBeUndefined();
      expect(retried?.failureReason).toBeUndefined();
      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late success after the timeout cannot resurrect a retried message', async () => {
    // Mirror of the stale-failure case: the original pipeline resolves after
    // the timeout + retry, and must not settle a message it no longer owns.
    vi.useFakeTimers();
    try {
      const api = fakeApi();
      const xmpp = fakeXmpp();
      xmpp.history['ana@zilar.test'] = [
        message({
          id: 'ana-1',
          chatJid: 'ana@zilar.test',
          body: 'older',
          timestamp: new Date('2026-09-28T09:00:00Z'),
        }),
      ];
      let releaseOriginal!: (value: { audio: Blob; durationMs: number }) => void;
      const gate = new Promise<{ audio: Blob; durationMs: number }>((resolve) => {
        releaseOriginal = resolve;
      });
      let attempt = 0;
      const convert = vi.fn(async (): Promise<{ audio: Blob; durationMs: number }> => {
        attempt += 1;
        if (attempt === 1) {
          return gate;
        }
        // The retry hangs too, so only the stale resolution is exercised.
        return new Promise(() => {});
      });
      const store = createRealChatStore({
        api,
        storage: memoryStorage(),
        now: () => new Date('2026-09-28T12:00:00Z'),
        createXmpp: () => xmpp.core,
        voice: fakeVoice({ convert }),
      });
      store.getState().start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      store.getState().sendVoice('ana@zilar.test', voiceRecording());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      const failedId = store.getState().messages('ana@zilar.test').at(-1)?.id ?? '';
      expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('failed');

      store.getState().retryVoice('ana@zilar.test', failedId);
      await vi.advanceTimersByTimeAsync(0);

      // The original pipeline now resolves: ignored, the retry still owns it.
      releaseOriginal({
        audio: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }),
        durationMs: 4321,
      });
      await vi.advanceTimersByTimeAsync(0);
      const during = store
        .getState()
        .messages('ana@zilar.test')
        .find((item) => item.id === failedId);
      expect(during?.status).toBe('sending');
      expect(
        store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.lastMessage?.status,
      ).toBe('sending');
      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a hung voice send is marked timed_out after 60 s', async () => {
    // The hanging pipeline here never settles; the stale late-result paths
    // (resolve/reject after timeout + retry) are covered by the two tests above.
    // Fake timers from the start (like the pins polling test): the store's
    // boot and every `flush` below advance them explicitly.
    vi.useFakeTimers();
    try {
      const api = fakeApi();
      const xmpp = fakeXmpp();
      xmpp.history['ana@zilar.test'] = [
        message({
          id: 'ana-1',
          chatJid: 'ana@zilar.test',
          body: 'older',
          timestamp: new Date('2026-09-28T09:00:00Z'),
        }),
      ];
      const hanging = (): Promise<{ audio: Blob; durationMs: number }> => new Promise(() => {});
      const store = createRealChatStore({
        api,
        storage: memoryStorage(),
        now: () => new Date('2026-09-28T12:00:00Z'),
        createXmpp: () => xmpp.core,
        voice: fakeVoice({ convert: vi.fn(hanging) }),
      });
      store.getState().start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      store.getState().sendVoice('ana@zilar.test', voiceRecording());
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('sending');

      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      const failed = store.getState().messages('ana@zilar.test').at(-1);
      expect(failed?.status).toBe('failed');
      expect(failed?.failureReason).toBe('timed_out');
      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a server echo for a failed-but-delivered send marks it sent with no Retry', async () => {
    const attachments = fakeAttachments({
      upload: vi.fn(async () => {
        throw new AttachmentError('upload_failed', 'nope');
      }),
    });
    const { store, xmpp } = await setup({}, undefined, { attachments });

    store.getState().sendAttachment('ana@zilar.test', imageFile(), { caption: 'late echo' });
    await flush();
    expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('failed');

    // The stanza the failed attempt almost sent finally echoes back.
    xmpp.emit(
      'message',
      message({
        id: 'srv-late',
        chatJid: 'ana@zilar.test',
        body: 'late echo',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    const echoed = store
      .getState()
      .messages('ana@zilar.test')
      .find((item) => item.id === 'srv-late');
    // An echo is proof of delivery: the bubble becomes `sent`, the failure
    // state clears, and no Retry remains.
    expect(echoed?.status).toBe('sent');
    expect(echoed?.failed).toBeUndefined();
    expect(echoed?.failureReason).toBeUndefined();
    expect(
      store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.lastMessage?.status,
    ).toBe('sent');
  });

  it('an attachment final-send failure ends failed with a reason', async () => {
    const { store, xmpp } = await setup({}, undefined, { attachments: fakeAttachments() });
    vi.mocked(xmpp.core.sendMessage).mockRejectedValueOnce(new Error('not online'));

    store.getState().sendAttachment('ana@zilar.test', imageFile(), { caption: 'send fails' });
    await flush();

    const failed = store.getState().messages('ana@zilar.test').at(-1);
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('network');
    expect(failed?.failed).toBe(true);
  });

  it('a double Retry click on a failed attachment sends only once', async () => {
    let attempt = 0;
    const upload = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new AttachmentError('upload_failed', 'nope');
      }
      return 'http://upload.zilar.test/get/1/photo.png';
    });
    const { store } = await setup({}, undefined, { attachments: fakeAttachments({ upload }) });

    store.getState().sendAttachment('ana@zilar.test', imageFile(), { caption: 'double retry' });
    await flush();
    const failedId = store.getState().messages('ana@zilar.test').at(-1)?.id ?? '';
    expect(store.getState().messages('ana@zilar.test').at(-1)?.status).toBe('failed');

    // Two Retry clicks in the same tick: the first flips to `sending`, the
    // second must return early instead of launching a second pipeline.
    store.getState().retryAttachment('ana@zilar.test', failedId);
    store.getState().retryAttachment('ana@zilar.test', failedId);
    await flush();

    expect(upload).toHaveBeenCalledTimes(2);
    const retried = store.getState().messages('ana@zilar.test').at(-1);
    expect(retried?.status).toBe('sent');
  });
});
