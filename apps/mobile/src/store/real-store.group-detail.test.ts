import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry, GroupDetail } from '../lib/chat-api';
import type { Topic, TopicsApi } from '../lib/topics-api';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApi, fakeAppState } from './test-support';

const GENERAL = 'general@rooms.zilar.test';
const BUG = 'bug-topic@rooms.zilar.test';

function topic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-general',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: GENERAL,
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
    roles: [],
    approverRole: null,
    ...overrides,
  };
}

function bugTopic(): Record<string, unknown> {
  return topic({
    id: 't-bug',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: BUG,
    kind: 'bug',
    status: 'in_progress',
    isGeneral: false,
  });
}

function groupEntry(topics: Record<string, unknown>[]): ChatEntry {
  return {
    kind: 'group',
    chatJid: GENERAL,
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 4,
    role: 'member',
    topics: topics as unknown as Topic[],
  } as ChatEntry;
}

function groupDetail(): GroupDetail {
  return {
    id: 'g1',
    title: 'Dev team',
    createdBy: 'u-me',
    members: [
      { userId: 'u-me', name: 'Me', role: 'owner', roles: [] },
      { userId: 'u-ana', name: 'Ana', role: 'member', roles: [] },
    ],
    ais: [],
  };
}

function fakeTopics(): TopicsApi {
  return {
    createTopic: vi.fn(async () => topic() as unknown as Topic),
    getTopic: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    patchTopic: vi.fn(async (id: string) => topic({ id, archived: true }) as unknown as Topic),
    archiveTopic: vi.fn(async (id: string) => topic({ id, archived: true }) as unknown as Topic),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    removeTopicMember: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    removeTopicAi: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    setTopicRoles: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    setMembersCanCreateTopics: vi.fn(async () => true),
  } as unknown as TopicsApi;
}

function setup(overrides: Partial<RealStoreDeps> = {}) {
  const api = fakeApi({
    getChats: vi.fn(async () => [groupEntry([topic(), bugTopic()])]),
    getGroup: vi.fn(async () => groupDetail()),
  });
  const store = createRealChatStore({
    api,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => createFakeXmppCore(),
    ...overrides,
  });
  return { store, api };
}

describe('mobile store group detail (T-0920)', () => {
  it('loads a group detail once and exposes it', async () => {
    const { store, api } = setup();
    store.getState().start();
    await flush();

    store.getState().ensureGroupDetail('g1');
    await flush();

    expect(api.getGroup).toHaveBeenCalledWith('g1');
    expect(store.getState().groupDetail('g1')?.title).toBe('Dev team');
    store.getState().stop();
  });

  it('shows the member list for a topic', async () => {
    const { store } = setup();
    store.getState().start();
    await flush();

    store.getState().openChat(GENERAL);
    await flush();

    expect(store.getState().groupMembers(GENERAL)).toEqual([
      { jid: 'u-ana@zilar.test', name: 'Ana' },
    ]);
    store.getState().stop();
  });

  it('loads the group detail once for two topics of the same group', async () => {
    const { store } = setup();
    store.getState().start();
    await flush();

    store.getState().openChat(GENERAL);
    await flush();
    store.getState().openChat(BUG);
    await flush();

    expect(
      store
        .getState()
        .groupMembers(GENERAL)
        .map((member) => member.name),
    ).toEqual(['Ana']);
    expect(
      store
        .getState()
        .groupMembers(BUG)
        .map((member) => member.name),
    ).toEqual(['Ana']);
    store.getState().stop();
  });

  it('drops an archived topic row (R17)', async () => {
    const { store } = setup({ topicsApi: fakeTopics() });
    store.getState().start();
    await flush();

    await store.getState().patchTopic(BUG, { archived: true });

    expect(store.getState().chats.some((chat) => chat.id === BUG)).toBe(false);
    store.getState().stop();
  });

  it('applies a topic update that arrives archived', async () => {
    const { store } = setup({ topicsApi: fakeTopics() });
    store.getState().start();
    await flush();

    await store.getState().patchTopic(BUG, { archived: true });

    expect(store.getState().chats.some((chat) => chat.id === GENERAL)).toBe(true);
    store.getState().stop();
  });
});
