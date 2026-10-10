import type { ChatPrefRow, ChatSummary } from '@zilar/chat-core';
import type { GroupDetail } from '@zilar/api-contract';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTopicRow,
  ensureGroupDetail,
  type GroupDetailStore,
  type TopicRowStore,
} from './groups';
import { NOW, testCtx } from './test-ctx';

const detail = (id: string): GroupDetail => ({
  id,
  title: id,
  createdBy: 'u-me',
  members: [],
  ais: [],
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

function cacheStore() {
  const details = new Map<string, GroupDetail>();
  const loading = new Set<string>();
  const published: string[] = [];
  const store: GroupDetailStore<GroupDetail> = {
    cached: (groupId) => details.get(groupId),
    isLoading: (groupId) => loading.has(groupId),
    begin: (groupId) => {
      loading.add(groupId);
    },
    finish: (groupId) => {
      loading.delete(groupId);
    },
    publish: (groupId, value) => {
      details.set(groupId, value);
      published.push(groupId);
    },
  };
  return { store, details, loading, published };
}

describe('ensureGroupDetail (core, R14)', () => {
  it('fetches once per group and serves the cached detail', async () => {
    const api = { getGroup: vi.fn(async (id: string) => detail(id)) };
    const { store, published } = cacheStore();

    expect(await run(ensureGroupDetail(api, store, 'g1'))).toEqual(detail('g1'));
    expect(await run(ensureGroupDetail(api, store, 'g1'))).toEqual(detail('g1'));

    expect(api.getGroup).toHaveBeenCalledTimes(1);
    expect(published).toEqual(['g1']);
  });

  it('re-fetches only for a forced refresh', async () => {
    const api = { getGroup: vi.fn(async (id: string) => detail(id)) };
    const { store } = cacheStore();

    await run(ensureGroupDetail(api, store, 'g1'));
    await run(ensureGroupDetail(api, store, 'g1', true));

    expect(api.getGroup).toHaveBeenCalledTimes(2);
  });

  it('does not start a second load while one is in flight', async () => {
    let release!: (value: GroupDetail) => void;
    const gate = new Promise<GroupDetail>((resolve) => {
      release = resolve;
    });
    const api = { getGroup: vi.fn(() => gate) };
    const { store } = cacheStore();

    const first = run(ensureGroupDetail(api, store, 'g1'));
    const second = run(ensureGroupDetail(api, store, 'g1'));
    release(detail('g1'));
    await Promise.all([first, second]);

    expect(api.getGroup).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure and clears the in-flight mark for a retry', async () => {
    const api = {
      getGroup: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const { store, loading } = cacheStore();

    expect(await run(ensureGroupDetail(api, store, 'g1'))).toBeUndefined();
    expect(loading.has('g1')).toBe(false);

    await run(ensureGroupDetail(api, store, 'g1'));
    expect(api.getGroup).toHaveBeenCalledTimes(2);
  });

  it('never calls for the empty group id', async () => {
    const api = { getGroup: vi.fn(async (id: string) => detail(id)) };
    const { store } = cacheStore();

    expect(await run(ensureGroupDetail(api, store, ''))).toBeUndefined();
    expect(api.getGroup).not.toHaveBeenCalled();
  });

  it('keeps one load per group id', async () => {
    const api = { getGroup: vi.fn(async (id: string) => detail(id)) };
    const { store } = cacheStore();

    await run(ensureGroupDetail(api, store, 'g1'));
    await run(ensureGroupDetail(api, store, 'g2'));
    await run(ensureGroupDetail(api, store, 'g1'));

    expect(api.getGroup.mock.calls.map((call) => call[0])).toEqual(['g1', 'g2']);
  });
});

function groupRow(
  chatId: string,
  topicId: string,
  overrides: Partial<ChatSummary> = {},
): ChatSummary {
  return {
    id: chatId,
    kind: 'group',
    title: chatId,
    unread: 0,
    groupId: 'g1',
    topic: {
      id: topicId,
      glyph: 'G',
      kind: 'chat',
      status: 'open',
      visibility: 'public',
      isGeneral: false,
      archived: false,
      owner: null,
      linkUrl: null,
      linkLabel: null,
    },
    ...overrides,
  } as unknown as ChatSummary;
}

const prefRow = (chatJid: string, pinnedAt: string | null = null): ChatPrefRow => ({
  chatJid,
  mutedUntil: null,
  archived: false,
  pinnedAt,
});

function topicStore(rows: ChatSummary[], prefs: ChatPrefRow[] = []) {
  const rememberGroupIds = vi.fn();
  const store: TopicRowStore = {
    getChats: async () => [{}],
    summariesFor: () => rows,
    rememberGroupIds,
    prefRows: () => prefs,
    now: () => NOW,
  };
  return { store, rememberGroupIds };
}

describe('applyTopicRow (core, R17)', () => {
  it('drops an archived topic row', async () => {
    const live = groupRow('general@rooms.zilar.test', 't-general');
    const { ctx, state } = testCtx({ state: { chats: [live] } });
    const { store } = topicStore([live]);

    await run(applyTopicRow(ctx, store, { id: 't-general', archived: true }));

    expect(state().chats).toEqual([]);
  });

  it('keeps local state and re-applies the saved prefs on a live row', async () => {
    const before = groupRow('general@rooms.zilar.test', 't-general', { unread: 5 });
    const fresh = groupRow('general@rooms.zilar.test', 't-general', {
      unread: 0,
      title: 'General',
    });
    const { ctx, state } = testCtx({ state: { chats: [before] } });
    const { store } = topicStore([fresh], [prefRow('general@rooms.zilar.test', NOW.toISOString())]);

    await run(applyTopicRow(ctx, store, { id: 't-general' }));

    const row = state().chats[0];
    expect(row?.unread).toBe(5);
    expect(row?.title).toBe('General');
    expect(row?.pinnedAt).toEqual(NOW);
  });

  it('remembers the group ids of the fresh page', async () => {
    const { ctx } = testCtx({ state: { chats: [] } });
    const { store, rememberGroupIds } = topicStore([]);

    await run(applyTopicRow(ctx, store, { id: 't-x' }));

    expect(rememberGroupIds).toHaveBeenCalledWith([{}]);
  });

  it('leaves the list untouched when the topic row is absent', async () => {
    const live = groupRow('general@rooms.zilar.test', 't-general');
    const { ctx, state } = testCtx({ state: { chats: [live] } });
    const { store } = topicStore([]);

    await run(applyTopicRow(ctx, store, { id: 't-unknown' }));

    expect(state().chats).toEqual([live]);
  });
});
