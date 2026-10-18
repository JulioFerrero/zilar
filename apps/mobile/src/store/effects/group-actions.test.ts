import { ApiError } from '@zilar/api-contract';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry } from '../../lib/chat-api';
import type { TopicsApi } from '../../lib/topics-api';
import { createRealChatStore } from '../real-store';
import { fakeApi, fakeAppState } from '../test-support';
import { flushTasks as flush } from '@/test/wait';

// Leaving a topic as its last member: the server archives the topic and
// answers 404, so the phone must re-read the chat list and treat a gone row as
// success, exactly like web (T-2041).

const TEAM = 'general@rooms.zilar.test';
const BUG = 't-1@rooms.zilar.test';
const NOW = new Date('2026-10-18T12:00:00Z');

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

function topicsApi(removeTopicMember: TopicsApi['removeTopicMember']): TopicsApi {
  return { removeTopicMember } as unknown as TopicsApi;
}

async function startedStore(
  entries: () => ChatEntry[],
  removeTopicMember: TopicsApi['removeTopicMember'],
) {
  const store = createRealChatStore({
    api: fakeApi({ getChats: vi.fn(async () => entries()) }),
    topicsApi: topicsApi(removeTopicMember),
    appState: fakeAppState(),
    now: () => NOW,
    openDrafts: () => () => {},
    createXmpp: () => createFakeXmppCore(),
  });
  store.getState().start();
  await flush();
  await flush();
  return store;
}

describe('leaving a topic as its last member', () => {
  it('succeeds when the server answers 404 and the refresh drops the row', async () => {
    const general = topicRow({ id: 't-g', name: 'General', isGeneral: true, chatJid: TEAM });
    let entries = [groupEntry([general, topicRow()])];
    const removeTopicMember = vi.fn(async () => {
      throw new ApiError(404, 'not_found', 'Topic not found');
    });
    const store = await startedStore(() => entries, removeTopicMember);
    expect(store.getState().chats.some((chat) => chat.id === BUG)).toBe(true);

    entries = [groupEntry([general])];

    await expect(store.getState().leaveTopic(BUG)).resolves.toBeUndefined();
    expect(removeTopicMember).toHaveBeenCalledWith('t-1', 'u-me');
  });

  it('fails on a 404 when the row is still in the list', async () => {
    const general = topicRow({ id: 't-g', name: 'General', isGeneral: true, chatJid: TEAM });
    const entries = [groupEntry([general, topicRow()])];
    const removeTopicMember = vi.fn(async () => {
      throw new ApiError(404, 'not_found', 'Topic not found');
    });
    const store = await startedStore(() => entries, removeTopicMember);
    expect(store.getState().chats.some((chat) => chat.id === BUG)).toBe(true);

    await expect(store.getState().leaveTopic(BUG)).rejects.toThrow('Topic not found');
  });

  it('fails on any other error even when the row is gone', async () => {
    const general = topicRow({ id: 't-g', name: 'General', isGeneral: true, chatJid: TEAM });
    let entries = [groupEntry([general, topicRow()])];
    const removeTopicMember = vi.fn(async () => {
      throw new ApiError(500, 'internal_error', 'Something went wrong');
    });
    const store = await startedStore(() => entries, removeTopicMember);
    expect(store.getState().chats.some((chat) => chat.id === BUG)).toBe(true);

    entries = [groupEntry([general])];

    await expect(store.getState().leaveTopic(BUG)).rejects.toThrow('Something went wrong');
  });
});
