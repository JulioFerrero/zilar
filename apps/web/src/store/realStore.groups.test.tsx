import { describe, expect, it, vi } from 'vitest';
import type { XmppCoreOptions } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp as baseFakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush } from '@/test/wait';
import type { ChatEntry, GroupDetail, Topic } from '@/lib/api';
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

function groupEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'group',
    chatJid: GENERAL,
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member',
    topics: [topic(), bugTopic()],
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

describe('web store group detail (T-0920)', () => {
  it('loads a group detail and exposes its members for a topic', async () => {
    const { store, api } = await setup();

    store.getState().openChat(GENERAL);
    await flush();

    expect(api.getGroup).toHaveBeenCalledWith('g1');
    expect(store.getState().groupInfo(GENERAL)?.title).toBe('Team');
    expect(store.getState().groupMembers(GENERAL)).toEqual([
      { jid: 'u-me@zilar.test', name: 'Me' },
      { jid: 'u-ana@zilar.test', name: 'Ana' },
    ]);
    store.getState().stop();
  });

  it('shows the member list for two topics of the same group', async () => {
    const { store } = await setup();

    store.getState().openChat(GENERAL);
    await flush();
    store.getState().openChat(BUG);
    await flush();

    expect(
      store
        .getState()
        .groupMembers(GENERAL)
        .map((member) => member.name),
    ).toEqual(['Me', 'Ana']);
    expect(
      store
        .getState()
        .groupMembers(BUG)
        .map((member) => member.name),
    ).toEqual(['Me', 'Ana']);
    store.getState().stop();
  });

  it('loads the group detail once for two topics of the same group (R14)', async () => {
    const { store, api } = await setup();

    store.getState().openChat(GENERAL);
    await flush();
    store.getState().openChat(BUG);
    await flush();

    expect(api.getGroup).toHaveBeenCalledTimes(1);
    store.getState().stop();
  });

  it('drops an archived topic row on a topic update', async () => {
    const { store } = await setup({
      patchTopic: vi.fn(async () => ({ ...bugTopic(), archived: true }) as Topic),
    });

    store.getState().openChat(BUG);
    await flush();
    await store.getState().patchTopic(BUG, { archived: true });

    expect(store.getState().chats.some((chat) => chat.id === BUG)).toBe(false);
    store.getState().stop();
  });
});
