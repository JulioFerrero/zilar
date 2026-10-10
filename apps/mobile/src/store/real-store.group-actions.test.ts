import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import type { ChatEntry, GroupDetail } from '../lib/chat-api';
import type {
  CreateTopicInput,
  PatchTopicInput,
  SetTopicRolesInput,
  Topic,
  TopicsApi,
} from '../lib/topics-api';
import { flushTasks as flush } from '@/test/wait';
import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApi, fakeAppState } from './test-support';

const GENERAL = 'general@rooms.zilar.test';
const BUG = 'bug-topic@rooms.zilar.test';
const NEW = 'new-topic@rooms.zilar.test';

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

function newTopic(): Record<string, unknown> {
  return topic({
    id: 't-new',
    name: 'New topic',
    glyph: 'N',
    chatJid: NEW,
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

function fakeTopics(overrides: Partial<TopicsApi> = {}): TopicsApi {
  return {
    createTopic: vi.fn(async () => newTopic() as unknown as Topic),
    getTopic: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    patchTopic: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    archiveTopic: vi.fn(async (id: string) => topic({ id, archived: true }) as unknown as Topic),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    removeTopicMember: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    removeTopicAi: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    setTopicRoles: vi.fn(async (id: string) => topic({ id }) as unknown as Topic),
    setMembersCanCreateTopics: vi.fn(async () => true),
    ...overrides,
  } as unknown as TopicsApi;
}

function setup(overrides: Partial<RealStoreDeps> = {}, topics: Partial<TopicsApi> = {}) {
  const api = fakeApi({
    getChats: vi.fn(async () => [groupEntry([topic(), bugTopic(), newTopic()])]),
    getGroup: vi.fn(async () => groupDetail()),
  });
  const topicsApi = fakeTopics(topics);
  const store = createRealChatStore({
    api,
    topicsApi,
    appState: fakeAppState(),
    openDrafts: () => () => {},
    createXmpp: () => createFakeXmppCore(),
    ...overrides,
  });
  return { store, api, topicsApi };
}

describe('mobile store group actions (T-0921)', () => {
  it('creates a topic and returns its row id', async () => {
    const { store, topicsApi } = setup(
      {},
      { createTopic: vi.fn(async () => newTopic() as unknown as Topic) },
    );
    store.getState().start();
    await flush();
    const input = { name: 'New topic' } as CreateTopicInput;

    const id = await store.getState().createTopic(GENERAL, input);

    expect(topicsApi.createTopic).toHaveBeenCalledWith('g1', input);
    expect(id).toBe(NEW);
    store.getState().stop();
  });

  it('patches the topic that owns the chat', async () => {
    const patchTopic = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const { store } = setup({}, { patchTopic });
    store.getState().start();
    await flush();
    const input = { name: 'Renamed' } as PatchTopicInput;

    await store.getState().patchTopic(BUG, input);

    expect(patchTopic).toHaveBeenCalledWith('t-bug', input);
    store.getState().stop();
  });

  it('adds and removes a topic member', async () => {
    const addTopicMember = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const removeTopicMember = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const { store } = setup({}, { addTopicMember, removeTopicMember });
    store.getState().start();
    await flush();

    await store.getState().addTopicMember(BUG, 'u-ana');
    await store.getState().removeTopicMember(BUG, 'u-ana');

    expect(addTopicMember).toHaveBeenCalledWith('t-bug', 'u-ana');
    expect(removeTopicMember).toHaveBeenCalledWith('t-bug', 'u-ana');
    store.getState().stop();
  });

  it('adds and removes a topic AI', async () => {
    const addTopicAi = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const removeTopicAi = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const { store } = setup({}, { addTopicAi, removeTopicAi });
    store.getState().start();
    await flush();

    await store.getState().addTopicAi(BUG, 'ai-1');
    await store.getState().removeTopicAi(BUG, 'ai-1');

    expect(addTopicAi).toHaveBeenCalledWith('t-bug', 'ai-1');
    expect(removeTopicAi).toHaveBeenCalledWith('t-bug', 'ai-1');
    store.getState().stop();
  });

  it('sets the topic roles', async () => {
    const setTopicRoles = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const { store } = setup({}, { setTopicRoles });
    store.getState().start();
    await flush();
    const input = { roleIds: [], approverRoleId: null } as SetTopicRolesInput;

    await store.getState().setTopicRoles(BUG, input);

    expect(setTopicRoles).toHaveBeenCalledWith('t-bug', input);
    store.getState().stop();
  });

  it('leaves a topic through the member route', async () => {
    const removeTopicMember = vi.fn(async (id: string) => topic({ id }) as unknown as Topic);
    const { store } = setup({}, { removeTopicMember });
    store.getState().start();
    await flush();

    await store.getState().leaveTopic(BUG);

    expect(removeTopicMember).toHaveBeenCalledWith('t-bug', 'u-me');
    store.getState().stop();
  });

  it('shows the error a failed topic write throws', async () => {
    const setTopicRoles = vi.fn(async () => {
      throw new Error('Could not save the roles.');
    });
    const { store } = setup({}, { setTopicRoles });
    store.getState().start();
    await flush();

    await expect(
      store.getState().setTopicRoles(BUG, { roleIds: ['r1'], approverRoleId: null }),
    ).rejects.toThrow('Could not save the roles.');
    store.getState().stop();
  });
});
