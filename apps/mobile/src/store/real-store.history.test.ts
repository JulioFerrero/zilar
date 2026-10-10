import type { ChatMessage, XmppCore } from '@zilar/xmpp-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../lib/chat-api';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApi, fakeAppState } from './test-support';
import { flushTasks as flush, waitFor } from '@/test/wait';

// History through the real mobile store: the first page, older pages until
// complete, opening at a message (a jump from search), the topic-gone case, and
// `loadOlder` while the first page is still loading (T-0917, written on the old
// code before the move to `@zilar/client-core/store`).

const ANA = 'ana@zilar.test';
const NOW = new Date('2026-09-28T12:00:00Z');

/** `count` messages from Ana, `ana-0` the oldest, one minute apart. */
function anaHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'chat' as const,
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

interface FakeXmpp {
  core: XmppCore;
  history: Record<string, ChatMessage[]>;
}

/** An online core whose `loadHistory` pages a list like the server. */
function fakeXmpp(): FakeXmpp {
  const history: Record<string, ChatMessage[]> = {};
  const core = {
    status: () => 'online' as const,
    me: () => 'me@zilar.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async () => {}),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn(() => []),
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
    on: (() => () => {}) as unknown as XmppCore['on'],
  } as unknown as XmppCore;
  return { core, history };
}

/** A booted store with Ana's chat holding `count` messages and a preview loaded. */
async function historySetup(count: number, deps: Partial<RealStoreDeps> = {}) {
  const xmpp = fakeXmpp();
  xmpp.history[ANA] = anaHistory(count);
  const store = createRealChatStore({
    api: fakeApi({
      getChats: vi.fn(async () => [
        { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
      ]),
    }),
    appState: fakeAppState(),
    now: () => NOW,
    openDrafts: () => () => {},
    createXmpp: () => xmpp.core,
    ...deps,
  });
  store.getState().start();
  await waitFor(() => store.getState().status === 'online');
  return { store, xmpp };
}

const messageIds = (store: Awaited<ReturnType<typeof historySetup>>['store']): string[] =>
  store
    .getState()
    .messages(ANA)
    .map((message) => message.id);

describe('the first page', () => {
  it('loads the newest 50 messages, marks them read and makes the chat ready', async () => {
    const { store, xmpp } = await historySetup(60);

    store.getState().openChat(ANA);
    await waitFor(() => store.getState().historyLoad[ANA] === 'loaded');

    expect(messageIds(store)).toEqual(ids(50, 10));
    expect(store.getState().hasMore(ANA)).toBe(true);
    expect(xmpp.core.markDisplayed).toHaveBeenLastCalledWith(ANA, 'chat', 'ana-59');
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.lastMessage?.id).toBe('ana-59');
  });
});

describe('older pages', () => {
  it('pages back 50 at a time until history is complete', async () => {
    const { store } = await historySetup(120);
    store.getState().openChat(ANA);
    await waitFor(() => store.getState().historyLoad[ANA] === 'loaded');

    store.getState().loadOlder(ANA);
    await waitFor(() => messageIds(store).length === 100);
    expect(messageIds(store)).toEqual(ids(100, 20));
    expect(store.getState().hasMore(ANA)).toBe(true);

    store.getState().loadOlder(ANA);
    await waitFor(() => messageIds(store).length === 120);
    expect(messageIds(store)).toEqual(ids(120));
    expect(store.getState().hasMore(ANA)).toBe(false);
  });
});

describe('open at a message (a jump from search)', () => {
  it('opens the chat and pages back until the message is loaded', async () => {
    const { store } = await historySetup(120);

    const found = await store.getState().openAtMessage(ANA, 'ana-3');

    expect(found.text).toBe('msg 3');
    expect(store.getState().activeChatId).toBe(ANA);
    expect(store.getState().jumpTarget).toEqual({ chatId: ANA, messageId: 'ana-3' });
    expect(messageIds(store)).toEqual(ids(120));
  });

  it('rejects message_not_found once history runs out', async () => {
    const { store } = await historySetup(60);

    await expect(store.getState().openAtMessage(ANA, 'ghost')).rejects.toThrow('message_not_found');
    expect(store.getState().jumpTarget).toBeUndefined();
  });
});

describe('loadOlder while the first page is still loading', () => {
  /** Calls `loadOlder` until history is complete, at most `max` times. */
  async function loadAll(
    store: Awaited<ReturnType<typeof historySetup>>['store'],
    max = 5,
  ): Promise<void> {
    for (let round = 0; round < max && store.getState().hasMore(ANA); round += 1) {
      store.getState().loadOlder(ANA);
      await flush();
    }
  }

  it('ends with each message once, in order, when the first page lands first', async () => {
    const { store } = await historySetup(60);

    store.getState().openChat(ANA);
    // The boot preview left a cursor at the newest message: this pages from it.
    store.getState().loadOlder(ANA);
    await flush();

    expect(new Set(messageIds(store)).size).toBe(messageIds(store).length);
    await loadAll(store);
    expect(messageIds(store)).toEqual(ids(60));
  });

  it('ends with each message once, in order, when the older page lands first', async () => {
    const { store, xmpp } = await historySetup(60);
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
});

const TEAM = 'general@rooms.zilar.test';
const BUG = 't-1@rooms.zilar.test';

function topicRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: BUG,
    visibility: 'public',
    kind: 'bug',
    status: 'in_progress',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: false,
    archived: false,
    memberCount: 6,
    ais: [],
    ...overrides,
  };
}

function groupEntry(topics: unknown[]): ChatEntry {
  return {
    kind: 'group',
    chatJid: TEAM,
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    topics,
  } as ChatEntry;
}

describe('a topic that disappears while open', () => {
  it('moves back with a name-free notice', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: TEAM,
    });
    const api = fakeApi({
      getChats: vi.fn(async () => [groupEntry([general, topicRow()])]),
    });
    const store = createRealChatStore({
      api,
      appState: fakeAppState(),
      now: () => NOW,
      openDrafts: () => () => {},
      createXmpp: () => createFakeXmppCore(),
    });
    store.getState().start();
    await flush();

    store.getState().openChat(BUG);
    vi.mocked(api.getChats).mockResolvedValue([groupEntry([general])]);
    store.getState().reloadChats();
    await flush();

    expect(store.getState().activeChatId).toBeNull();
    expect(store.getState().topicNotice).toEqual({
      groupId: 'g1',
      message: 'This topic is no longer available.',
    });
  });
});
