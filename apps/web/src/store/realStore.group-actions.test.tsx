import { describe, expect, it, vi } from 'vitest';
import type { XmppCoreOptions } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp as baseFakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import type {
  ChatEntry,
  CreateTopicInput,
  GroupDetail,
  PatchTopicInput,
  SetTopicRolesInput,
  Topic,
} from '@/lib/api';
import { createRealChatStore, type ApiClient, type StorageLike } from './realStore';

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

const GENERAL = 'general@rooms.zilar.test';
const BUG = 'bug-topic@rooms.zilar.test';
const NEW = 'new-topic@rooms.zilar.test';

function topic(overrides: Record<string, unknown> = {}): Topic {
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
    ...overrides,
  } as Topic;
}

function bugTopic(): Topic {
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

function newTopic(): Topic {
  return topic({
    id: 't-new',
    name: 'New topic',
    glyph: 'N',
    chatJid: NEW,
    isGeneral: false,
  });
}

function groupEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'group',
    chatJid: GENERAL,
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member',
    topics: [topic(), bugTopic(), newTopic()],
    ...overrides,
  } as ChatEntry;
}

function groupDetail(): GroupDetail {
  return {
    id: 'g1',
    title: 'Team',
    createdBy: 'u-me',
    members: [
      { userId: 'u-me', name: 'Me', role: 'owner' },
      { userId: 'u-ana', name: 'Ana', role: 'member' },
    ],
    ais: [],
  };
}

function fakeXmpp() {
  const joined: string[] = [];
  const xmpp = baseFakeXmpp({
    joinRoom: vi.fn(async (roomJid: string) => {
      joined.push(roomJid);
    }),
  });
  return { ...xmpp, joined };
}

async function setup(overrides: Partial<ApiClient> = {}) {
  const api = fakeApi({
    getChats: vi.fn(async () => [groupEntry()]),
    getGroup: vi.fn(async () => groupDetail()),
    ...overrides,
  });
  const xmpp = fakeXmpp();
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: (_options: XmppCoreOptions) => xmpp.core,
  });
  store.getState().start();
  await flush();
  return { store, api, xmpp };
}

describe('web store group actions (T-0921)', () => {
  it('creates a topic, joins its room and returns its row id', async () => {
    const createTopic = vi.fn(async () => newTopic());
    const { store, api, xmpp } = await setup({ createTopic });
    const input: CreateTopicInput = { name: 'New topic' };

    const id = await store.getState().createTopic(GENERAL, input);
    await flush();

    expect(api.createTopic).toHaveBeenCalledWith('g1', input);
    expect(id).toBe(NEW);
    expect(xmpp.joined).toContain(NEW);
    store.getState().stop();
  });

  it('patches the topic that owns the chat', async () => {
    const patchTopic = vi.fn(async (topicId: string) => topic({ id: topicId, name: 'Renamed' }));
    const { store, api } = await setup({ patchTopic });
    const input: PatchTopicInput = { name: 'Renamed' };

    await store.getState().patchTopic(BUG, input);

    expect(api.patchTopic).toHaveBeenCalledWith('t-bug', input);
    store.getState().stop();
  });

  it('adds and removes a topic member', async () => {
    const addTopicMember = vi.fn(async (topicId: string) => topic({ id: topicId }));
    const removeTopicMember = vi.fn(async (topicId: string) => topic({ id: topicId }));
    const { store, api } = await setup({ addTopicMember, removeTopicMember });

    await store.getState().addTopicMember(BUG, 'u-ana');
    await store.getState().removeTopicMember(BUG, 'u-ana');

    expect(api.addTopicMember).toHaveBeenCalledWith('t-bug', 'u-ana');
    expect(api.removeTopicMember).toHaveBeenCalledWith('t-bug', 'u-ana');
    store.getState().stop();
  });

  it('adds and removes a topic AI', async () => {
    const addTopicAi = vi.fn(async (topicId: string) => topic({ id: topicId }));
    const removeTopicAi = vi.fn(async (topicId: string) => topic({ id: topicId }));
    const { store, api } = await setup({ addTopicAi, removeTopicAi });

    await store.getState().addTopicAi(BUG, 'ai-1');
    await store.getState().removeTopicAi(BUG, 'ai-1');

    expect(api.addTopicAi).toHaveBeenCalledWith('t-bug', 'ai-1');
    expect(api.removeTopicAi).toHaveBeenCalledWith('t-bug', 'ai-1');
    store.getState().stop();
  });

  it('sets the topic roles', async () => {
    const setTopicRoles = vi.fn(async (topicId: string) => topic({ id: topicId }));
    const { store, api } = await setup({ setTopicRoles });
    const input: SetTopicRolesInput = { roleIds: [], approverRoleId: null };

    await store.getState().setTopicRoles(BUG, input);

    expect(api.setTopicRoles).toHaveBeenCalledWith('t-bug', input);
    store.getState().stop();
  });

  it('leaves a topic through the member route', async () => {
    const removeTopicMember = vi.fn(async (topicId: string) => topic({ id: topicId }));
    const { store, api } = await setup({ removeTopicMember });

    await store.getState().leaveTopic(BUG);

    expect(api.removeTopicMember).toHaveBeenCalledWith('t-bug', 'u-me');
    store.getState().stop();
  });

  it('shows the error a failed topic write throws', async () => {
    const setTopicRoles = vi.fn(async () => {
      throw new Error('Could not save the roles.');
    });
    const { store } = await setup({ setTopicRoles });
    const input: SetTopicRolesInput = { roleIds: ['r1'], approverRoleId: null };

    await expect(store.getState().setTopicRoles(BUG, input)).rejects.toThrow(
      'Could not save the roles.',
    );
    store.getState().stop();
  });
});
