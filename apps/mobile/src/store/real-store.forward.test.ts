import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import type { ChatApi, ChatEntry } from '../lib/chat-api';
import { createRealChatStore } from './real-store';
import { flushTasks as flush } from '@/test/wait';

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
    requestUploadSlot: vi.fn(async () => ({ putUrl: '', getUrl: '', headers: {} })),
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

function fakeApi(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@zilar.test',
      name: 'Me',
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
    ...overrides,
  };
}

// Two DMs and a group to forward into, so a target never equals the source.
const targetChats: ChatEntry[] = [
  { kind: 'dm', chatJid: 'ana@zilar.test', title: 'Ana', userId: 'u-ana' },
  { kind: 'dm', chatJid: 'luis@zilar.test', title: 'Luis', userId: 'u-luis' },
  {
    kind: 'group',
    chatJid: 'team@rooms.zilar.test',
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member',
  },
];

async function setup(overrides: Partial<ChatApi> = {}) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
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

describe('forwardMessages (T-0432)', () => {
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

  it('keeps the sticker payload on a forwarded copy', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();
    const data = {
      pack_id: '11111111-1111-4111-8111-111111111111',
      sticker_id: '21111111-1111-4111-8111-111111111111',
      url: 'http://upload.zilar.test/get/1/cat.webp',
      width: 200,
      height: 200,
      mime: 'image/webp' as const,
    };

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: '', card: { v: 0, type: 'sticker', data } })],
      );

    expect(send).toHaveBeenCalledWith('luis@zilar.test', 'chat', '', {
      payload: { v: 0, type: 'sticker', data },
      forward: {
        sender_id: 'ana@zilar.test',
        sender_name: 'Ana',
        original_at: '2026-09-28T10:00:00.000Z',
      },
    });
  });

  it('skips a deleted message, and with a comment sends nothing to that target', async () => {
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

  it('sends the comment as a separate text message after the copies', async () => {
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
    expect(send).toHaveBeenNthCalledWith(2, 'luis@zilar.test', 'chat', 'see this', undefined);
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

  it('marks only the rejected copy failed', async () => {
    const { store, xmpp } = await setup({ getChats: vi.fn(async () => targetChats) });
    const send = vi.mocked(xmpp.core.sendMessage);
    send.mockClear();
    send.mockRejectedValueOnce(new Error('boom'));

    store
      .getState()
      .forwardMessages(
        ['luis@zilar.test', 'team@rooms.zilar.test'],
        [source({ chatId: 'ana@zilar.test', text: 'nope' })],
      );
    await flush();

    const failed = store.getState().messages('luis@zilar.test').at(-1);
    expect(failed?.failed).toBe(true);
    expect(failed?.status).toBe('sending');

    const sent = store.getState().messages('team@rooms.zilar.test').at(-1);
    expect(sent?.failed).toBeUndefined();
    expect(sent?.status).toBe('sent');
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
});
