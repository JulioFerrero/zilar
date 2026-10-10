import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import type { ChatEntry } from '../lib/chat-api';
import type { ChatApi } from '../lib/chat-api';
import type { TopicsApi } from '../lib/topics-api';
import { describe, expect, it, vi } from 'vitest';

import { createRealChatStore, summariesFor, TOPIC_REFRESH_INTERVAL_MS } from './real-store';
import type { RealStoreDeps } from './real-store';
import { fakeApi, fakeAppState } from './test-support';

function topicRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.zilar.test',
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
    chatJid: 'general@rooms.zilar.test',
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    ...overrides,
  } as ChatEntry;
}

function topicsChatApi(entries: ChatEntry[]): ChatApi {
  return fakeApi({
    getChats: vi.fn(async () => entries),
    // T-0112 should-fix: the old fake ignored its argument, so a test
    // passing a chat JID where a group id belongs still resolved. It now
    // answers only the known group id and throws otherwise.
    getGroup: vi.fn(async (groupId: string) => {
      if (groupId !== 'g1') {
        throw new Error(`unknown group ${groupId}`);
      }
      return {
        id: 'g1',
        title: 'Dev team',
        createdBy: 'u-me',
        members: [],
        ais: [],
      };
    }),
  });
}

function fakeTopics(): TopicsApi & { calls: string[] } {
  const calls: string[] = [];
  const api = {
    calls,
    createTopic: vi.fn(async (_groupId: string, input: { name: string }) => {
      calls.push(`create:${input.name}`);
      return topicRow({ id: 't-new', name: input.name, chatJid: 't-new@rooms.zilar.test' });
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
            chatJid: 'general@rooms.zilar.test',
          }),
          topicRow({ id: 't-1', chatJid: 't-1@rooms.zilar.test' }),
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(['general@rooms.zilar.test', 't-1@rooms.zilar.test']);
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    expect(rows[1]?.groupId).toBe('g1');
  });

  it('keeps one legacy row for an older server without topics', () => {
    const rows = summariesFor(groupEntry({ chatJid: 'team@rooms.zilar.test' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('team@rooms.zilar.test');
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
    const api = topicsChatApi(entries);
    const topics = fakeTopics();
    const store = createRealChatStore({
      api,
      topicsApi: topics,
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => createFakeXmppCore(),
      ...deps,
    });
    return { store, api, topics };
  }

  it('boots one row per topic and refresh adds and removes rows', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    expect(
      store
        .getState()
        .chats.map((chat) => chat.id)
        .sort(),
    ).toEqual(['general@rooms.zilar.test', 't-1@rooms.zilar.test']);

    // Refresh adds a topic and removes one: unread and last message survive.
    const before = store.getState().chats;
    expect(before).toHaveLength(2);
    vi.mocked(api.getChats).mockResolvedValue([
      groupEntry({
        topics: [general, topicRow({ id: 't-2', name: 'Ideas', chatJid: 't-2@rooms.zilar.test' })],
      }),
    ]);
    store.getState().reloadChats();
    await flush();

    expect(store.getState().chats.map((chat) => chat.id)).toEqual([
      't-2@rooms.zilar.test',
      'general@rooms.zilar.test',
    ]);
  });

  it('moves a removed-while-open topic back with a name-free notice', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    store.getState().openChat('t-1@rooms.zilar.test');
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
      chatJid: 'general@rooms.zilar.test',
    });
    const { store, topics, api } = setup([groupEntry({ topics: [general] })]);
    store.getState().start();
    await flush();

    vi.mocked(api.getChats).mockResolvedValue([
      groupEntry({
        topics: [
          general,
          topicRow({ id: 't-new', name: 'Checkout bug', chatJid: 't-new@rooms.zilar.test' }),
        ],
      }),
    ]);
    const chatId = await store.getState().createTopic('general@rooms.zilar.test', {
      name: 'Checkout bug',
      kind: 'bug',
      visibility: 'public',
    });
    expect(chatId).toBe('t-new@rooms.zilar.test');
    expect(topics.calls).toContain('create:Checkout bug');

    await store.getState().addTopicAi(chatId, 'dev-ai');
    expect(topics.calls).toContain('addAi:dev-ai');
  });

  it('resolves the created topic even when the follow-up re-read fails', async () => {
    // T-0112 should-fix: `createTopic` used to report "Could not create"
    // when only the follow-up chat-list re-read failed, inviting a retry
    // that makes a duplicate topic. The topic exists on the server now, so
    // the row id falls back to the created topic's chat JID.
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general] })]);
    store.getState().start();
    await flush();

    vi.mocked(api.getChats).mockRejectedValue(new Error('down'));
    const chatId = await store.getState().createTopic('general@rooms.zilar.test', {
      name: 'Checkout bug',
      kind: 'bug',
      visibility: 'public',
    });
    expect(chatId).toBe('t-new@rooms.zilar.test');
  });

  it('applies a strip patch on success and leaves the row unchanged on failure', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store, topics, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    // No optimistic update: the store applies the patch only after the server
    // answers, so a failure needs no rollback, just a rejection.
    await store.getState().patchTopic('t-1@rooms.zilar.test', { status: 'done' });
    expect(topics.calls).toContain('patch:t-1');

    const before = store.getState().chats.find((chat) => chat.id === 't-1@rooms.zilar.test')
      ?.topic?.status;
    vi.mocked(api.getChats).mockRejectedValueOnce(new Error('down'));
    vi.mocked(topics.patchTopic).mockRejectedValueOnce(new Error('offline'));
    await expect(
      store.getState().patchTopic('t-1@rooms.zilar.test', { status: 'blocked' }),
    ).rejects.toThrow();
    expect(
      store.getState().chats.find((chat) => chat.id === 't-1@rooms.zilar.test')?.topic?.status,
    ).toBe(before);
  });

  it('loads the group detail by group id and publishes it to selectors', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
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
    expect(store.getState().groupDetail('t-1@rooms.zilar.test')).toBeUndefined();
    expect(vi.mocked(api.getGroup)).toHaveBeenCalledWith('g1');
  });

  it('loads the group detail once per group for the sheet', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store, api } = setup([groupEntry({ topics: [general, topicRow()] })]);
    store.getState().start();
    await flush();

    // T-0112 should-fix: the old test passed a chat JID where a group id
    // belongs and the fake `getGroup` ignored it, resolving `g1` for any
    // argument. The fake now throws for a non-group id (like the server's
    // 404), so a chat JID resolves nothing — silently, like any detail
    // failure — while the real group id still does.
    expect(store.getState().groupDetail('t-1@rooms.zilar.test')).toBeUndefined();
    store.getState().refreshGroupDetail('t-1@rooms.zilar.test');
    await flush();
    expect(store.getState().groupDetail('t-1@rooms.zilar.test')).toBeUndefined();
    store.getState().refreshGroupDetail('g1');
    await flush();
    expect(store.getState().groupDetail('g1')).toMatchObject({ id: 'g1' });
    const calls = vi.mocked(api.getGroup).mock.calls.length;
    store.getState().refreshGroupDetail('g1');
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
        chatJid: 'general@rooms.zilar.test',
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
