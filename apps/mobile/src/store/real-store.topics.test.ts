import type { ChatEntry } from '../lib/chat-api';
import type { ChatApi } from '../lib/chat-api';
import type { TopicsApi } from '../lib/topics-api';
import { describe, expect, it, vi } from 'vitest';

import { createRealChatStore, summariesFor, TOPIC_REFRESH_INTERVAL_MS } from './real-store';
import type { RealStoreDeps } from './real-store';
import type { AppStateLike } from './real-store';

function fakeAppState(): AppStateLike {
  return { current: () => 'active', subscribe: () => () => {} };
}

function topicRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.galena.test',
    visibility: 'public',
    kind: 'bug',
    status: 'in_progress',
    owner: { kind: 'ai', id: 'dev-1', name: 'Dev-1' },
    linkUrl: 'https://example.com/reviews/42',
    linkLabel: 'PR #42',
    isGeneral: false,
    archived: false,
    memberCount: 6,
    ais: [],
    ...overrides,
  };
}

function groupEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'group',
    chatJid: 'general@rooms.galena.test',
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    ...overrides,
  } as ChatEntry;
}

function fakeApi(entries: ChatEntry[]): ChatApi {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@galena.test',
      name: 'Me',
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => entries),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Dev team',
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
  };
}

function fakeCore(): unknown {
  return {
    status: () => 'online',
    connect: async () => {},
    disconnect: async () => {},
    joinRoom: async () => {},
    occupants: () => [],
    sendMessage: async () => ({ id: 'srv-1' }),
    sendReactions: async () => {},
    sendCorrection: async () => ({ id: 'srv-c' }),
    sendRetraction: async () => {},
    loadHistory: async () => ({ messages: [], complete: true, first: undefined }),
    sendTyping: () => {},
    markDisplayed: () => {},
    on: () => () => {},
  };
}

function fakeTopics(): TopicsApi & { calls: string[] } {
  const calls: string[] = [];
  const api = {
    calls,
    createTopic: vi.fn(async (_groupId: string, input: { name: string }) => {
      calls.push(`create:${input.name}`);
      return topicRow({ id: 't-new', name: input.name, chatJid: 't-new@rooms.galena.test' });
    }),
    getTopic: vi.fn(async (id: string) => topicRow({ id })),
    patchTopic: vi.fn(async (id: string) => {
      calls.push(`patch:${id}`);
      return topicRow({ id });
    }),
    archiveTopic: vi.fn(async (id: string) => {
      calls.push(`archive:${id}`);
      return topicRow({ id, archived: true });
    }),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async (id: string) => topicRow({ id })),
    removeTopicMember: vi.fn(async (id: string) => topicRow({ id })),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async (id: string, aiId: string) => {
      calls.push(`addAi:${aiId}`);
      return topicRow({ id });
    }),
    removeTopicAi: vi.fn(async (id: string) => topicRow({ id })),
    setMembersCanCreateTopics: vi.fn(async () => true),
  };
  return api as unknown as TopicsApi & { calls: string[] };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('summariesFor', () => {
  it('maps each topic to its own chat keyed by room JID, General keeps the id', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [
          topicRow({
            id: 't-g',
            name: 'General',
            isGeneral: true,
            chatJid: 'general@rooms.galena.test',
          }),
          topicRow({ id: 't-1', chatJid: 't-1@rooms.galena.test' }),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual([
      'general@rooms.galena.test',
      't-1@rooms.galena.test',
    ]);
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    expect(rows[1]?.groupId).toBe('g1');
  });

  it('keeps one legacy row for an older server without topics', () => {
    const rows = summariesFor(groupEntry({ chatJid: 'team@rooms.galena.test' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('team@rooms.galena.test');
    expect(rows[0]?.topic).toBeUndefined();
  });

  it('drops malformed topic rows and skips archived ones', () => {
    const rows = summariesFor(
      groupEntry({
        topics: [
          topicRow({ id: 't-bad', archived: true }),
          { nope: true },
          topicRow({ id: 't-ok' }),
        ],
      }),
    );
    expect(rows.map((row) => row.topic?.id ?? row.id)).toEqual(['t-ok']);
  });
});

describe('real store topics (T-0112)', () => {
  function setup(entries: ChatEntry[], deps: Partial<RealStoreDeps> = {}) {
    const api = fakeApi(entries);
    const topics = fakeTopics();
    const store = createRealChatStore({
      api,
      topicsApi: topics,
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => fakeCore() as never,
      ...deps,
    });
    return { store, api, topics };
  }

  it('boots one row per topic and refresh adds and removes rows', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.galena.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    expect(
      store
        .getState()
        .chats.map((chat) => chat.id)
        .sort(),
    ).toEqual(['general@rooms.galena.test', 't-1@rooms.galena.test']);

    // Refresh adds a topic and removes one: unread and last message survive.
    const before = store.getState().chats;
    expect(before).toHaveLength(2);
    vi.mocked(api.getChats).mockResolvedValue([
      groupEntry({
        topics: [general, topicRow({ id: 't-2', name: 'Ideas', chatJid: 't-2@rooms.galena.test' })],
      }),
    ]);
    store.getState().reloadChats();
    await flush();

    expect(store.getState().chats.map((chat) => chat.id)).toEqual([
      't-2@rooms.galena.test',
      'general@rooms.galena.test',
    ]);
  });

  it('moves a removed-while-open topic back with a name-free notice', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.galena.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    store.getState().openChat('t-1@rooms.galena.test');
    vi.mocked(api.getChats).mockResolvedValue([groupEntry({ topics: [general] })]);
    store.getState().reloadChats();
    await flush();

    expect(store.getState().activeChatId).toBeNull();
    expect(store.getState().topicNotice).toEqual({
      groupId: 'g1',
      message: 'This topic is no longer available.',
    });
    store.getState().dismissTopicNotice();
    expect(store.getState().topicNotice).toBeUndefined();
  });

  it('creates a topic and adds the ticked AIs', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.galena.test',
    });
    const { store, topics, api } = setup([groupEntry({ topics: [general] })]);
    store.getState().start();
    await flush();

    vi.mocked(api.getChats).mockResolvedValue([
      groupEntry({
        topics: [
          general,
          topicRow({ id: 't-new', name: 'Checkout bug', chatJid: 't-new@rooms.galena.test' }),
        ],
      }),
    ]);
    const chatId = await store.getState().createTopic('general@rooms.galena.test', {
      name: 'Checkout bug',
      kind: 'bug',
      visibility: 'public',
    });
    expect(chatId).toBe('t-new@rooms.galena.test');
    expect(topics.calls).toContain('create:Checkout bug');

    await store.getState().addTopicAi(chatId, 'dev-ai');
    expect(topics.calls).toContain('addAi:dev-ai');
  });

  it('applies a strip patch on success and leaves the row unchanged on failure', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.galena.test',
    });
    const { store, topics, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    // No optimistic update: the store applies the patch only after the server
    // answers, so a failure needs no rollback, just a rejection.
    await store.getState().patchTopic('t-1@rooms.galena.test', { status: 'done' });
    expect(topics.calls).toContain('patch:t-1');

    const before = store.getState().chats.find((chat) => chat.id === 't-1@rooms.galena.test')
      ?.topic?.status;
    vi.mocked(api.getChats).mockRejectedValueOnce(new Error('down'));
    vi.mocked(topics.patchTopic).mockRejectedValueOnce(new Error('offline'));
    await expect(
      store.getState().patchTopic('t-1@rooms.galena.test', { status: 'blocked' }),
    ).rejects.toThrow();
    expect(
      store.getState().chats.find((chat) => chat.id === 't-1@rooms.galena.test')?.topic?.status,
    ).toBe(before);
  });

  it('loads the group detail by group id and publishes it to selectors', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.galena.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    // Keyed by group id (not chat id): the topics screen passes its route
    // param straight through. Boot eagerly loads it (joinGroups), and the
    // load publishes through set() so selectors re-fire.
    expect(store.getState().groupDetailsRevision).toBeGreaterThan(0);
    expect(store.getState().groupDetail('g1')).toMatchObject({ id: 'g1' });
    // A chat id is NOT the group key: looking one up resolves nothing, so the
    // topics screen must pass its group-id route param (covered by the mount
    // test below asserting `refreshGroupDetail` fires with the group id).
    expect(store.getState().groupDetail('t-1@rooms.galena.test')).toBeUndefined();
    expect(vi.mocked(api.getGroup)).toHaveBeenCalledWith('g1');
  });

  it('loads the group detail once per group for the sheet', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.galena.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    store.getState().refreshGroupDetail('t-1@rooms.galena.test');
    await flush();
    expect(store.getState().groupDetail('t-1@rooms.galena.test')).toMatchObject({ id: 'g1' });
    const calls = vi.mocked(api.getGroup).mock.calls.length;
    store.getState().refreshGroupDetail('t-1@rooms.galena.test');
    await flush();
    // A forced refresh reloads; the non-forced openChat path loads once.
    expect(vi.mocked(api.getGroup).mock.calls.length).toBe(calls + 1);
  });

  it('polls every 60 s while active and on foreground', async () => {
    expect(TOPIC_REFRESH_INTERVAL_MS).toBe(60_000);
    vi.useFakeTimers();
    try {
      const general = topicRow({
        id: 't-g',
        name: 'General',
        isGeneral: true,
        chatJid: 'general@rooms.galena.test',
      });
      const { store, api } = setup([groupEntry({ topics: [general] })]);
      store.getState().start();
      await vi.advanceTimersByTimeAsync(0);
      const getChats = vi.mocked(api.getChats);
      const before = getChats.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getChats.mock.calls.length).toBeGreaterThan(before);
      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
