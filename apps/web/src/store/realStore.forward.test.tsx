import { describe, expect, it, vi } from 'vitest';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import {
  createRealChatStore,
  type ApiClient,
  type RealStoreDeps,
  type StorageLike,
} from './realStore';

// Sign-out must not hit Better Auth over the network in a test.
vi.mock('@/lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => ({})) },
}));

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

let sourceSequence = 0;

function source(overrides: Partial<UiMessage> & { chatId: string }): UiMessage {
  sourceSequence += 1;
  const base: UiMessage = {
    id: `src-${sourceSequence}`,
    chatId: overrides.chatId,
    senderId: 'ana@zilar.test',
    senderName: 'Ana',
    text: 'hello there',
    createdAt: new Date('2026-09-28T10:00:00Z'),
    status: 'read',
  };
  return { ...base, ...overrides };
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
  let sent = 0;

  const core = {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn((): Occupant[] => []),
    sendMessage: vi.fn(async () => ({ id: `srv-${(sent += 1)}` })),
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

// Two DMs and a group to forward into, so a target never equals the source.
const targetChats = [
  { kind: 'dm' as const, chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
  { kind: 'dm' as const, chatJid: 'luis@zilar.test', title: 'Luis', userId: 'u-luis' },
  {
    kind: 'group' as const,
    chatJid: 'team@rooms.zilar.test',
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member' as const,
  },
];

async function setup(overrides: Partial<ApiClient> = {}, deps: Partial<RealStoreDeps> = {}) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp };
}

function privateTopic(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id: 'secret@rooms.zilar.test',
    title: 'Secret topic',
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    memberCount: 2,
    onlineCount: 0,
    visibility: 'private',
    handle: null,
    groupId: 'g1',
    groupTitle: 'Team',
    topic: {
      id: 't-private',
      glyph: '#',
      kind: 'chat',
      status: 'open',
      visibility: 'private',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  };
}

describe('forwardMessages (T-0414)', () => {
  it('sends one copy per target with the forward origin and no reply or mentions', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test', 'team@rooms.zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: 'hello there' })],
      );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'luis@zilar.test', 'chat', 'hello there', {
      forward: {
        sender_id: 'ana@zilar.test',
        sender_name: 'Ana',
        original_at: '2026-09-28T10:00:00.000Z',
      },
    });
    expect(send).toHaveBeenNthCalledWith(2, 'team@rooms.zilar.test', 'groupchat', 'hello there', {
      forward: {
        sender_id: 'ana@zilar.test',
        sender_name: 'Ana',
        original_at: '2026-09-28T10:00:00.000Z',
      },
    });
  });

  it('reuses the source attachment url in the payload', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();
    const attachment = {
      kind: 'file' as const,
      url: 'http://upload.zilar.test/get/1/report.pdf',
      name: 'report.pdf',
      size: 12,
      mime: 'application/pdf',
    };

    store
      .getState()
      .forwardMessages(
        ['team@rooms.zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: '', attachment })],
      );

    expect(send).toHaveBeenCalledWith('team@rooms.zilar.test', 'groupchat', '', {
      payload: { v: 0, type: 'attachment', data: attachment },
      forward: {
        sender_id: 'ana@zilar.test',
        sender_name: 'Ana',
        original_at: '2026-09-28T10:00:00.000Z',
      },
    });
  });

  it('skips a deleted message', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: 'gone', deleted: true })],
      );

    expect(send).not.toHaveBeenCalled();
    expect(store.getState().messages('luis@zilar.test')).toHaveLength(0);
  });

  it('sends nothing to a target whose only message was skipped, comment included', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: 'gone', deleted: true })],
        { comment: 'look at this' },
      );

    expect(send).not.toHaveBeenCalled();
    expect(store.getState().messages('luis@zilar.test')).toHaveLength(0);
  });

  it('keeps the original author on a forward of a forward', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();

    store.getState().forwardMessages(
      ['team@rooms.zilar.test'],
      [
        source({
          chatId: 'ana@zilar.test',
          text: 'from luis',
          forward: {
            sender_id: 'luis@zilar.test',
            sender_name: 'Luis',
            original_at: '2026-08-30T18:00:00.000Z',
          },
        }),
      ],
    );

    expect(send).toHaveBeenCalledWith('team@rooms.zilar.test', 'groupchat', 'from luis', {
      forward: {
        sender_id: 'luis@zilar.test',
        sender_name: 'Luis',
        original_at: '2026-08-30T18:00:00.000Z',
      },
    });
  });

  it('omits chat_id and chat_name for a private-topic source', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();
    store.setState((state) => ({ chats: [...state.chats, privateTopic()] }));

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test'],
        [source({ chatId: 'secret@rooms.zilar.test', text: 'secret' })],
      );

    const options = send.mock.calls[0]?.[3];
    expect(options?.forward?.chat_id).toBeUndefined();
    expect(options?.forward?.chat_name).toBeUndefined();
    expect(options?.forward?.sender_name).toBe('Ana');
  });

  it('carries chat_id and chat_name for a public group source', async () => {
    const { store, xmpp } = await setup({
      getChats: vi.fn(async () => [
        ...targetChats,
        {
          kind: 'group' as const,
          chatJid: 'pub@rooms.zilar.test',
          title: 'Public room',
          groupId: 'g2',
          memberCount: 5,
          role: 'member' as const,
          visibility: 'public' as const,
        },
      ]),
    });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test'],
        [source({ chatId: 'pub@rooms.zilar.test', text: 'public hello' })],
      );

    expect(send).toHaveBeenCalledWith('luis@zilar.test', 'chat', 'public hello', {
      forward: {
        sender_id: 'ana@zilar.test',
        sender_name: 'Ana',
        chat_id: 'pub@rooms.zilar.test',
        chat_name: 'Public room',
        original_at: '2026-09-28T10:00:00.000Z',
      },
    });
  });

  it('sends the comment as a separate text message after the forwards', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();

    store
      .getState()
      .forwardMessages(['luis@zilar.test'], [source({ chatId: 'ana@zilar.test', text: 'hi' })], {
        comment: '  see this  ',
      });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[3]).toHaveProperty('forward');
    expect(send).toHaveBeenNthCalledWith(2, 'luis@zilar.test', 'chat', 'see this', {});
  });

  it('replaces the optimistic bubble with the server echo without duplicating it', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: 'echo me' })],
      );
    expect(store.getState().messages('luis@zilar.test')).toHaveLength(1);

    xmpp.emit(
      'message',
      message({
        id: 'srv-echo',
        chatJid: 'luis@zilar.test',
        body: 'echo me',
        fromJid: 'me@zilar.test',
        outgoing: true,
        timestamp: new Date('2026-09-28T12:02:00Z'),
      }),
    );

    const copies = store
      .getState()
      .messages('luis@zilar.test')
      .filter((item) => item.text === 'echo me');
    expect(copies).toHaveLength(1);
    expect(copies[0]?.id).toBe('srv-echo');
  });

  it('marks a rejected forward failed with a fixed reason', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    vi.mocked(xmpp.core.sendMessage).mockClear();
    vi.mocked(xmpp.core.sendMessage).mockRejectedValueOnce(new Error('boom'));

    store
      .getState()
      .forwardMessages(['luis@zilar.test'], [source({ chatId: 'ana@zilar.test', text: 'nope' })]);
    await flush();

    const bubble = store.getState().messages('luis@zilar.test').at(-1);
    expect(bubble?.status).toBe('failed');
    expect(bubble?.failed).toBe(true);
    expect(bubble?.failureReason).toBe('network');
  });
});
