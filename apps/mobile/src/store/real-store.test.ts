import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@galena/xmpp-core';
import { describe, expect, it, vi } from 'vitest';

import { connectionLabel } from '../lib/connection';
import type { ChatApi } from '../lib/chat-api';
import type { DraftEventListener, DraftHubEvent } from '../lib/drafts';
import {
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  createRealChatStore,
  type AppStateLike,
  type RealStoreDeps,
} from './real-store';

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

interface FakeAppState extends AppStateLike {
  setActive(): void;
  setBackground(): void;
}

function fakeAppState(): FakeAppState {
  let state = 'active';
  const handlers = new Set<(next: string) => void>();
  return {
    current: () => state,
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    setActive() {
      state = 'active';
      for (const handler of handlers) handler(state);
    },
    setBackground() {
      state = 'background';
      for (const handler of handlers) handler(state);
    },
  };
}

interface FakeXmpp {
  core: XmppCore;
  history: Record<string, ChatMessage[]>;
  options: { current?: XmppCoreOptions };
  emit: (event: string, payload: unknown) => void;
}

function fakeXmpp(connectGate?: Promise<void>): FakeXmpp {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const history: Record<string, ChatMessage[]> = {};
  const options: { current?: XmppCoreOptions } = {};

  const core = {
    status: () => 'online' as const,
    me: () => 'me@galena.test',
    connect: vi.fn(async () => {
      await connectGate;
    }),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn((): Occupant[] => []),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
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
      email: 'me@galena.test',
      name: 'Me',
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
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Flushes microtasks until `predicate` holds (or gives up after 50 rounds). */
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let round = 0; round < 50 && !predicate(); round += 1) {
    await flush();
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function setup(
  overrides: Partial<ChatApi> = {},
  deps: Partial<RealStoreDeps> = {},
  connectGate?: Promise<void>,
) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp(connectGate);
  const appState = fakeAppState();
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
    appState,
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp, appState };
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

  it('keeps the bubble and the list in agreement through sending and reading', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendText('ana@galena.test', 'agree');
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
      outgoing: false,
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
      outgoing: false,
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
      outgoing: false,
    });
    expect(store.getState().typing['team@rooms.galena.test']).toBeUndefined();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'ana@galena.test',
      state: 'composing',
      outgoing: false,
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
      outgoing: false,
    });
    expect(store.getState().messages('team@rooms.galena.test').at(-1)?.status).toBe('sent');

    xmpp.emit('displayed', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'ana@galena.test',
      messageId: 'srv-1',
      outgoing: false,
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
      outgoing: false,
    });

    expect(store.getState().typing['team@rooms.galena.test']?.names).toEqual(['Luis']);
  });

  it('shows Someone instead of a JID localpart for an unknown group sender', async () => {
    const { store, xmpp } = await setup();

    xmpp.emit('typing', {
      chatJid: 'team@rooms.galena.test',
      fromJid: 'z9y8x7@galena.test',
      state: 'composing',
      outgoing: false,
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
      outgoing: false,
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

  it('reflects connection status changes and the connecting bar', async () => {
    const { store, xmpp } = await setup();
    expect(store.getState().status).toBe('online');
    expect(connectionLabel(store.getState().status)).toBeUndefined();

    xmpp.emit('status', 'reconnecting');
    expect(store.getState().status).toBe('reconnecting');
    expect(connectionLabel(store.getState().status)).toBe('Connecting…');

    xmpp.emit('status', 'offline');
    expect(connectionLabel(store.getState().status)).toBe('Waiting for network…');

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

  it('reconnects when the app returns to the foreground and is not online', async () => {
    const { store, xmpp, appState } = await setup();
    expect(xmpp.core.connect).toHaveBeenCalledTimes(1);

    xmpp.emit('status', 'offline');
    expect(store.getState().status).toBe('offline');

    appState.setActive();
    await flush();

    expect(xmpp.core.connect).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe('online');
  });

  it('does not reconnect while already online', async () => {
    const { xmpp, appState } = await setup();
    appState.setActive();
    await flush();
    expect(xmpp.core.connect).toHaveBeenCalledTimes(1);
  });
});

describe('AI reply drafts (T-0056)', () => {
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
    let listener: DraftEventListener | undefined;
    const close = vi.fn((): void => {
      listener = undefined;
    });
    const open = vi.fn((onEvent: DraftEventListener): (() => void) => {
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
    const { store } = await setup({}, { openDrafts: drafts.open });
    expect(drafts.open).toHaveBeenCalledTimes(1);

    drafts.emit(draft(CHAT, TURN_ONE, 'Hel'));
    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Hel' });

    drafts.emit(draft(CHAT, TURN_ONE, 'Hello there'));
    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Hello there' });
  });

  it('replaces the draft with a message that arrives before end, in one update', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));

    const seen: Array<{ draft: boolean; message: boolean }> = [];
    const unsubscribe = store.subscribe((state) => {
      seen.push({
        draft: state.drafts[CHAT] !== undefined,
        message: state.messages(CHAT).some((item) => item.text === 'Hello'),
      });
    });

    xmpp.emit('message', message({ id: 'ai-1', chatJid: CHAT, body: 'Hello', fromJid: CHAT }));
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
    const { store, xmpp } = await setup({}, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hi'));
    drafts.emit(end(CHAT, TURN_ONE));

    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Hi' });

    xmpp.emit('message', message({ id: 'ai-2', chatJid: CHAT, body: 'Hi', fromJid: CHAT }));
    expect(store.getState().drafts[CHAT]).toBeUndefined();
  });

  it('keeps the draft when my own JID sends a message during the turn', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Half a sentence'));

    // A message from my own JID (e.g. my second device) is not the AI's reply.
    xmpp.emit(
      'message',
      message({
        id: 'mine-1',
        chatJid: CHAT,
        body: 'note to self',
        fromJid: 'me@galena.test',
      }),
    );

    expect(store.getState().drafts[CHAT]).toEqual({ turnId: TURN_ONE, text: 'Half a sentence' });

    // The turn is not finished: a later draft still applies.
    drafts.emit(draft(CHAT, TURN_ONE, 'Half a sentence, then more'));
    expect(store.getState().drafts[CHAT]).toEqual({
      turnId: TURN_ONE,
      text: 'Half a sentence, then more',
    });
  });

  it('drops a finished draft after the fallback when no message arrives', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, { openDrafts: drafts.open });
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

  it('drops an idle draft without finishing the turn, so it can resume', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, { openDrafts: drafts.open });
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
    const { store } = await setup({}, { openDrafts: drafts.open });
    vi.useFakeTimers();
    try {
      drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));
      vi.advanceTimersByTime(50_000);
      expect(store.getState().drafts[CHAT]).toBeDefined();

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
    const { store } = await setup({}, { openDrafts: drafts.open });

    drafts.emit(draft(CHAT, TURN_ONE, 'Let me check that'));
    drafts.emit(draft(CHAT, TURN_ONE, 'Done'));

    expect(store.getState().drafts[CHAT]?.text).toBe('Done');
  });

  it('lets the next turn replace a finished draft without a stale fallback', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, { openDrafts: drafts.open });
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

  it('records which message finished the draft turn', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, { openDrafts: drafts.open });
    drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));

    xmpp.emit('message', message({ id: 'ai-1', chatJid: CHAT, body: 'Hello', fromJid: CHAT }));

    expect(store.getState().finishedDraftMessages['ai-1']).toBe(TURN_ONE);
  });

  it('caps the finished-draft message record', async () => {
    const drafts = fakeDrafts();
    const { store, xmpp } = await setup({}, { openDrafts: drafts.open });

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

  it('closes the stream on stop, clears the draft state and leaves no second stream', async () => {
    const drafts = fakeDrafts();
    const { store } = await setup({}, { openDrafts: drafts.open });
    expect(drafts.open).toHaveBeenCalledTimes(1);

    store.getState().start();
    await flush();
    expect(drafts.open).toHaveBeenCalledTimes(1);

    drafts.emit(draft(CHAT, TURN_ONE, 'Hello'));
    store.getState().stop();
    expect(drafts.close).toHaveBeenCalledTimes(1);
    expect(store.getState().drafts).toEqual({});
    expect(store.getState().finishedDraftMessages).toEqual({});

    store.getState().start();
    await flush();
    expect(drafts.open).toHaveBeenCalledTimes(2);
    expect(drafts.close).toHaveBeenCalledTimes(1);
  });
});

describe('loading states (T-0067)', () => {
  const ANA = 'ana@galena.test';

  it('reports the chat list as loading until it arrives, then loaded', async () => {
    const gate = deferred();
    const base = fakeApi();
    const { store } = await setup({
      getChats: vi.fn(async () => {
        await gate.promise;
        return base.getChats();
      }),
    });
    expect(store.getState().chatsLoad).toBe('loading');
    expect(store.getState().chats).toHaveLength(0);

    gate.resolve();
    await flushUntil(() => store.getState().chatsLoad === 'loaded');

    expect(store.getState().chatsLoad).toBe('loaded');
    expect(store.getState().chats.map((chat) => chat.id)).toEqual(['team@rooms.galena.test', ANA]);
  });

  it('lands a failed chat list in error and reloadChats recovers', async () => {
    let failFirst = true;
    const base = fakeApi();
    const { store } = await setup({
      getChats: vi.fn(async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error('server down');
        }
        return base.getChats();
      }),
    });

    expect(store.getState().chatsLoad).toBe('error');
    expect(store.getState().chats).toHaveLength(0);

    store.getState().reloadChats();
    await flushUntil(() => store.getState().chatsLoad === 'loaded');

    expect(store.getState().chatsLoad).toBe('loaded');
    expect(store.getState().chats).toHaveLength(2);
  });

  it('does not query history while the core is connecting, then flushes on ready', async () => {
    const gate = deferred();
    const { store, xmpp } = await setup({}, {}, gate.promise);
    expect(store.getState().chatsLoad).toBe('loaded');
    const loadHistory = vi.mocked(xmpp.core.loadHistory);
    loadHistory.mockClear();

    store.getState().openChat(ANA);
    expect(loadHistory).not.toHaveBeenCalled();
    expect(store.getState().historyLoad[ANA]).toBe('loading');

    gate.resolve();
    await flushUntil(() => store.getState().historyLoad[ANA] === 'loaded');

    expect(loadHistory).toHaveBeenCalledWith(ANA, 'chat', { max: 50 });
    expect(
      store
        .getState()
        .messages(ANA)
        .map((item) => item.id),
    ).toContain('ana-2');
  });

  it('flushes an open chat when the chat appears after the open', async () => {
    const gate = deferred();
    const base = fakeApi();
    const { store, xmpp } = await setup({
      getChats: vi.fn(async () => {
        await gate.promise;
        return base.getChats();
      }),
    });
    const loadHistory = vi.mocked(xmpp.core.loadHistory);
    loadHistory.mockClear();

    store.getState().openChat(ANA);
    expect(loadHistory).not.toHaveBeenCalled();
    expect(store.getState().historyLoad[ANA]).toBe('loading');

    gate.resolve();
    await flushUntil(() => store.getState().historyLoad[ANA] === 'loaded');

    expect(loadHistory).toHaveBeenCalledWith(ANA, 'chat', { max: 50 });
    expect(
      store
        .getState()
        .messages(ANA)
        .map((item) => item.id),
    ).toContain('ana-2');
  });

  it('loads a chat opened again once, not twice, across the pending flush', async () => {
    const gate = deferred();
    const { store, xmpp } = await setup({}, {}, gate.promise);
    const loadHistory = vi.mocked(xmpp.core.loadHistory);
    loadHistory.mockClear();

    store.getState().openChat(ANA);
    store.getState().openChat(ANA);

    gate.resolve();
    await flushUntil(() => store.getState().historyLoad[ANA] === 'loaded');

    const pageLoads = loadHistory.mock.calls.filter((call) => call[2]?.max === 50);
    expect(pageLoads).toHaveLength(1);
  });

  it('loads only the latest chat when a second chat is opened before ready', async () => {
    const gate = deferred();
    const { store, xmpp } = await setup({}, {}, gate.promise);
    const loadHistory = vi.mocked(xmpp.core.loadHistory);
    loadHistory.mockClear();

    store.getState().openChat(ANA);
    store.getState().openChat('team@rooms.galena.test');
    // The superseded chat's pending marker is cleared, so it is not loading.
    expect(store.getState().historyLoad[ANA]).toBeUndefined();
    expect(store.getState().historyLoad['team@rooms.galena.test']).toBe('loading');

    gate.resolve();
    await flushUntil(() => store.getState().historyLoad['team@rooms.galena.test'] === 'loaded');

    const pageLoads = loadHistory.mock.calls.filter((call) => call[2]?.max === 50);
    expect(pageLoads).toHaveLength(1);
    expect(pageLoads[0]?.[0]).toBe('team@rooms.galena.test');
  });

  it('lands a failed history in error and retryHistory recovers', async () => {
    const { store, xmpp } = await setup();
    const loadHistory = vi.mocked(xmpp.core.loadHistory);
    loadHistory.mockRejectedValueOnce(new Error('MAM failed'));

    store.getState().openChat(ANA);
    await flushUntil(() => store.getState().historyLoad[ANA] === 'error');

    expect(store.getState().historyLoad[ANA]).toBe('error');
    expect(store.getState().messages(ANA)).toHaveLength(0);

    store.getState().retryHistory(ANA);
    await flushUntil(() => store.getState().historyLoad[ANA] === 'loaded');

    expect(store.getState().historyLoad[ANA]).toBe('loaded');
    expect(
      store
        .getState()
        .messages(ANA)
        .map((item) => item.id),
    ).toContain('ana-2');
  });

  it('re-flushes the pending open after a reconnect', async () => {
    const { store, xmpp, appState } = await setup();
    xmpp.emit('status', 'offline');
    const loadHistory = vi.mocked(xmpp.core.loadHistory);
    loadHistory.mockClear();

    store.getState().openChat(ANA);
    expect(loadHistory).not.toHaveBeenCalled();
    expect(store.getState().historyLoad[ANA]).toBe('loading');

    appState.setActive();
    await flushUntil(() => store.getState().historyLoad[ANA] === 'loaded');

    expect(loadHistory).toHaveBeenCalledWith(ANA, 'chat', { max: 50 });
    expect(store.getState().historyLoad[ANA]).toBe('loaded');
  });

  it('never moves a loaded chat list back to loading on a background refresh', async () => {
    const { store, xmpp, api } = await setup();
    const getChats = vi.mocked(api.getChats);
    const before = getChats.mock.calls.length;

    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const unsubscribe = store.subscribe((state) => seen.push(state.chatsLoad));
      xmpp.emit('roster', {});
      await vi.advanceTimersByTimeAsync(600);
      unsubscribe();

      expect(getChats.mock.calls.length).toBeGreaterThan(before);
      expect(seen).not.toContain('loading');
      expect(seen).toContain('loaded');
    } finally {
      vi.useRealTimers();
    }
  });
});
