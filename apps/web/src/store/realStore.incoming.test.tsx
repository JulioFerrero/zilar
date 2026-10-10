import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps, type StorageLike } from './realStore';

// Incoming events, message actions, reads and paging through the real web
// store, for the paths no other store test covers (T-0907, written on the old
// code before the move to `@zilar/client-core/store`).

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const NOW = new Date('2026-09-28T12:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function message(overrides: Partial<ChatMessage> & { id: string; chatJid: string }): ChatMessage {
  return {
    kind: overrides.chatJid.includes('@rooms.') ? 'groupchat' : 'chat',
    fromJid: ANA,
    fromResolved: true,
    body: overrides.id,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    ...overrides,
  };
}

async function setup(deps: Partial<RealStoreDeps> = {}) {
  const xmpp = fakeXmpp();
  xmpp.history[ANA] = [message({ id: 'ana-1', chatJid: ANA, body: 'older' })];
  const storage = memoryStorage();
  const store = createRealChatStore({
    api: fakeApi(),
    storage,
    now: () => NOW,
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, xmpp, storage };
}

const typing = (state: string) => ({ chatJid: ANA, fromJid: ANA, state, outgoing: false });

describe('the typing line', () => {
  it('clears 5 s after the last composing event', async () => {
    const { store, xmpp } = await setup();
    vi.useFakeTimers();

    xmpp.emit('typing', typing('composing'));
    expect(store.getState().typing[ANA]?.names).toEqual(['Ana']);
    vi.advanceTimersByTime(3_000);
    // A new composing event restarts the 5 s wait.
    xmpp.emit('typing', typing('composing'));
    vi.advanceTimersByTime(4_999);
    expect(store.getState().typing[ANA]?.names).toEqual(['Ana']);
    vi.advanceTimersByTime(1);
    expect(store.getState().typing[ANA]).toBeUndefined();
  });

  it('clears at once on paused, and the old wait cannot clear a later line', async () => {
    const { store, xmpp } = await setup();
    vi.useFakeTimers();

    xmpp.emit('typing', typing('composing'));
    xmpp.emit('typing', typing('paused'));
    expect(store.getState().typing[ANA]).toBeUndefined();

    vi.advanceTimersByTime(4_000);
    xmpp.emit('typing', typing('composing'));
    // The first wait would have ended here; it was cancelled with the pause.
    vi.advanceTimersByTime(2_000);
    expect(store.getState().typing[ANA]?.names).toEqual(['Ana']);
    vi.advanceTimersByTime(3_000);
    expect(store.getState().typing[ANA]).toBeUndefined();
  });
});

describe('a live message and the read state', () => {
  it('marks a message in the open, visible chat read and saves the last read', async () => {
    const { store, xmpp, storage } = await setup();
    store.getState().openChat(ANA);
    await flush();

    xmpp.emit('message', message({ id: 'ana-2', chatJid: ANA }));

    expect(store.getState().chats.find((chat) => chat.id === ANA)?.unread).toBe(0);
    expect(xmpp.core.markDisplayed).toHaveBeenLastCalledWith(ANA, 'chat', 'ana-2');
    expect(JSON.parse(storage.data.get('zilar:lastRead:u-me') ?? '{}')).toEqual({
      [ANA]: 'ana-2',
    });
  });

  it('counts a message in the open chat as unread while the tab is hidden', async () => {
    const { store, xmpp } = await setup({ documentVisible: () => false });
    store.getState().openChat(ANA);
    await flush();
    vi.mocked(xmpp.core.markDisplayed).mockClear();

    xmpp.emit('message', message({ id: 'ana-2', chatJid: ANA }));

    expect(store.getState().chats.find((chat) => chat.id === ANA)?.unread).toBe(1);
    expect(xmpp.core.markDisplayed).not.toHaveBeenCalled();
  });
});

describe('room occupants and presence', () => {
  it('counts the available occupants and never shrinks the member count', async () => {
    const { store, xmpp } = await setup();
    const occupant = (nick: string, available: boolean) => ({
      jid: `${TEAM}/${nick}`,
      nick,
      available,
    });

    xmpp.emit('occupants', {
      roomJid: TEAM,
      occupants: [occupant('ana', true), occupant('luis', false)],
    });
    let team = store.getState().chats.find((chat) => chat.id === TEAM);
    expect(team?.onlineCount).toBe(1);
    expect(team?.memberCount).toBe(3);

    xmpp.emit('occupants', {
      roomJid: TEAM,
      occupants: ['a', 'b', 'c', 'd'].map((nick) => occupant(nick, true)),
    });
    team = store.getState().chats.find((chat) => chat.id === TEAM);
    expect(team?.onlineCount).toBe(4);
    expect(team?.memberCount).toBe(4);
  });

  it('stamps last seen when a contact goes offline', async () => {
    const { store, xmpp } = await setup();
    xmpp.emit('presence', { jid: ANA, available: true });
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.lastSeenAt).toBeUndefined();
    xmpp.emit('presence', { jid: ANA, available: false });
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.lastSeenAt).toEqual(NOW);
  });
});

describe('message actions', () => {
  it('sends no correction for an unchanged or empty edit', async () => {
    const { store, xmpp } = await setup();
    store.getState().openChat(ANA);
    await flush();
    store.getState().sendText(ANA, 'hello');
    await flush();
    const local = store.getState().messages(ANA).at(-1)?.id ?? '';

    store.getState().editMessage(ANA, local, '  hello  ');
    store.getState().editMessage(ANA, local, '   ');

    expect(xmpp.core.sendCorrection).not.toHaveBeenCalled();
    expect(store.getState().messages(ANA).at(-1)?.text).toBe('hello');
  });

  it('sends the typing signal with the chat kind, and nothing for an unknown chat', async () => {
    const { store, xmpp } = await setup();

    store.getState().sendTyping(TEAM);
    store.getState().sendTyping('nobody@zilar.test');

    expect(xmpp.core.sendTyping).toHaveBeenCalledTimes(1);
    expect(xmpp.core.sendTyping).toHaveBeenCalledWith(TEAM, 'groupchat', 'composing');
  });
});

describe('history paging', () => {
  const pageLoads = (xmpp: ReturnType<typeof fakeXmpp>, before: string) =>
    vi
      .mocked(xmpp.core.loadHistory)
      .mock.calls.filter(([chat, , options]) => chat === ANA && options?.before === before).length;

  it('loads one older page when loadOlder is called twice at once', async () => {
    const { store, xmpp } = await setup();
    xmpp.history[ANA] = Array.from({ length: 60 }, (_, index) =>
      message({
        id: `ana-${index}`,
        chatJid: ANA,
        timestamp: new Date(Date.UTC(2026, 8, 28, 8, index)),
      }),
    );
    store.getState().openChat(ANA);
    await flush();

    store.getState().loadOlder(ANA);
    store.getState().loadOlder(ANA);
    await flush();

    expect(pageLoads(xmpp, 'ana-10')).toBe(1);
    expect(store.getState().messages(ANA)).toHaveLength(60);
  });
});
