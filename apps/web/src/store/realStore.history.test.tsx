import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { ChatEntry } from '@/lib/api';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps, type StorageLike } from './realStore';

// History through the real web store: the first page, older pages, opening
// at a message and the topic-gone case (T-0912, written on the old code
// before the move to `@zilar/client-core/store`).

const ANA = 'ana@zilar.test';
const TEAM = 'team@rooms.zilar.test';
const BUG = 'bug-topic@rooms.zilar.test';
const NOW = new Date('2026-09-28T12:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

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

/** `count` messages from Ana, `ana-0` the oldest, one minute apart. */
function anaHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'chat',
    chatJid: ANA,
    id: `ana-${index}`,
    fromJid: ANA,
    fromResolved: true,
    body: `msg ${index}`,
    timestamp: new Date(Date.UTC(2026, 8, 28, 6, index)),
    outgoing: false,
  }));
}

const ids = (count: number, from = 0): string[] =>
  Array.from({ length: count }, (_, index) => `ana-${from + index}`);

/** A store whose fake XMPP holds `count` messages in Ana's chat from the start. */
async function setup(count: number, deps: Partial<RealStoreDeps> = {}) {
  const xmpp = fakeXmpp();
  xmpp.history[ANA] = anaHistory(count);
  const store = createRealChatStore({
    api: fakeApi(),
    storage: memoryStorage(),
    now: () => NOW,
    createXmpp: (options) => {
      xmpp.options.current = options;
      return xmpp.core;
    },
    ...deps,
  });
  store.getState().start();
  await flush();
  return { store, xmpp };
}

const messageIds = (store: Awaited<ReturnType<typeof setup>>['store']): string[] =>
  store
    .getState()
    .messages(ANA)
    .map((message) => message.id);

describe('the first page', () => {
  it('loads the newest 50 messages, marks them read and makes the chat ready', async () => {
    const { store, xmpp } = await setup(60);

    store.getState().openChat(ANA);
    await flush();

    expect(messageIds(store)).toEqual(ids(50, 10));
    expect(store.getState().historyStateFor(ANA)).toBe('ready');
    expect(store.getState().hasMore(ANA)).toBe(true);
    expect(xmpp.core.markDisplayed).toHaveBeenLastCalledWith(ANA, 'chat', 'ana-59');
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.lastMessage?.id).toBe('ana-59');
  });
});

describe('older pages', () => {
  it('pages back 50 at a time until history is complete', async () => {
    const { store } = await setup(120);
    store.getState().openChat(ANA);
    await flush();

    store.getState().loadOlder(ANA);
    await flush();
    expect(messageIds(store)).toEqual(ids(100, 20));
    expect(store.getState().hasMore(ANA)).toBe(true);

    store.getState().loadOlder(ANA);
    await flush();
    expect(messageIds(store)).toEqual(ids(120));
    expect(store.getState().hasMore(ANA)).toBe(false);
  });
});

describe('loadOlder while the first page is still loading', () => {
  /** Calls `loadOlder` until history is complete, at most `max` times. */
  async function loadAll(store: Awaited<ReturnType<typeof setup>>['store'], max = 5) {
    for (let round = 0; round < max && store.getState().hasMore(ANA); round += 1) {
      store.getState().loadOlder(ANA);
      await flush();
    }
  }

  it('ends with each message once, in order, when the first page lands first', async () => {
    const { store } = await setup(60);

    store.getState().openChat(ANA);
    // The boot preview left a cursor at the newest message: this pages from it.
    store.getState().loadOlder(ANA);
    await flush();

    expect(new Set(messageIds(store)).size).toBe(messageIds(store).length);
    await loadAll(store);
    expect(messageIds(store)).toEqual(ids(60));
  });

  it('ends with each message once, in order, when the older page lands first', async () => {
    const { store, xmpp } = await setup(60);
    const base = vi.mocked(xmpp.core.loadHistory).getMockImplementation();
    if (base === undefined) {
      throw new Error('the fake loadHistory has no implementation');
    }
    let releaseFirstPage: () => void = () => {};
    const firstPageGate = new Promise<void>((resolve) => {
      releaseFirstPage = resolve;
    });
    vi.mocked(xmpp.core.loadHistory).mockImplementation(async (chatJid, kind, options) => {
      if (options?.before === undefined) {
        await firstPageGate;
      }
      return base(chatJid, kind, options);
    });

    store.getState().openChat(ANA);
    store.getState().loadOlder(ANA);
    await flush();
    releaseFirstPage();
    await flush();

    expect(new Set(messageIds(store)).size).toBe(messageIds(store).length);
    await loadAll(store);
    expect(messageIds(store)).toEqual(ids(60));
  });

  it('two loadOlder calls at once fetch one page, not two', async () => {
    const { store, xmpp } = await setup(60);
    const olderPages = () =>
      vi
        .mocked(xmpp.core.loadHistory)
        .mock.calls.filter(([, , options]) => options?.before !== undefined).length;

    store.getState().openChat(ANA);
    store.getState().loadOlder(ANA);
    store.getState().loadOlder(ANA);
    await flush();

    expect(olderPages()).toBe(1);
    expect(new Set(messageIds(store)).size).toBe(messageIds(store).length);
  });
});

describe('open at a message (a jump from search)', () => {
  it('opens the chat and pages back until the message is loaded', async () => {
    const { store } = await setup(120);

    const found = await store.getState().openAtMessage(ANA, 'ana-3');

    expect(found.text).toBe('msg 3');
    expect(store.getState().activeChatId).toBe(ANA);
    expect(messageIds(store)).toEqual(ids(120));
  });

  it('rejects message_not_found once history runs out', async () => {
    const { store } = await setup(60);

    await expect(store.getState().openAtMessage(ANA, 'ghost')).rejects.toThrow('message_not_found');
    expect(messageIds(store)).toEqual(ids(60));
  });
});

describe('a topic that disappears while open', () => {
  const topic = (overrides: Record<string, unknown>) => ({
    id: 't-general',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: TEAM,
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
    archived: false,
    memberCount: 3,
    ais: [],
    ...overrides,
  });
  const general = topic({});
  const bug = topic({ id: 't-bug', name: 'Bug', chatJid: BUG, kind: 'bug', isGeneral: false });
  const team = (topics: unknown[]): ChatEntry =>
    ({
      kind: 'group',
      chatJid: TEAM,
      title: 'Team',
      groupId: 'g1',
      memberCount: 3,
      role: 'member',
      topics,
    }) as ChatEntry;

  it('moves to General with a notice', async () => {
    const getChats = vi.fn(async () => [team([general, bug])]);
    const { store } = await setup(1, { api: fakeApi({ getChats }) });
    store.getState().openChat(BUG);
    await flush();
    vi.useFakeTimers();

    getChats.mockResolvedValue([team([general])]);
    store.getState().refreshChats();
    await vi.advanceTimersByTimeAsync(600);
    await flush();

    expect(store.getState().activeChatId).toBe(TEAM);
    expect(store.getState().topicNotice).toEqual({
      chatId: TEAM,
      message: 'This topic is no longer available.',
    });
  });
});
