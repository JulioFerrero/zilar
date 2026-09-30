import type { ChatEntry } from '../lib/chat-api';
import type { ChatApi } from '../lib/chat-api';
import type { ChatPrefsApi } from '../lib/chat-prefs-api';
import type { PinsApi } from '../lib/pins-api';
import type { TopicsApi } from '../lib/topics-api';
import { describe, expect, it, vi } from 'vitest';

import { parseTopic, type Topic } from '../lib/topics-api';

import { createRealChatStore, type RealStoreDeps } from './real-store';
import type { AppStateLike } from './real-store';

function fakeAppState(): AppStateLike {
  return { current: () => 'active', subscribe: () => () => {} };
}

function topicWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-g',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: 'general@rooms.galena.test',
    visibility: 'public',
    kind: 'chat',
    status: 'open',
    owner: null,
    linkUrl: null,
    linkLabel: null,
    isGeneral: true,
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

function fakeApi(entries: ChatEntry[], myRole: 'owner' | 'admin' | 'member' = 'admin') {
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@galena.test',
      name: 'Me',
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => entries),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async (groupId: string) => ({
      id: groupId,
      title: 'Dev team',
      createdBy: 'u-me',
      members: [
        { userId: 'u-me', name: 'Me', role: myRole, roles: [] },
        { userId: 'u-ana', name: 'Ana', role: 'member' as const, roles: [] },
      ],
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

function fakeTopics(): TopicsApi {
  return {
    createTopic: vi.fn(async () => topicWire()),
    getTopic: vi.fn(async (id: string) => topicWire({ id })),
    patchTopic: vi.fn(async (id: string) => topicWire({ id })),
    archiveTopic: vi.fn(async (id: string) => topicWire({ id, archived: true })),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async (id: string) => topicWire({ id })),
    removeTopicMember: vi.fn(async (id: string) => topicWire({ id })),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async (id: string) => topicWire({ id })),
    removeTopicAi: vi.fn(async (id: string) => topicWire({ id })),
    setMembersCanCreateTopics: vi.fn(async () => true),
  } as unknown as TopicsApi;
}

function fakePrefs(): ChatPrefsApi {
  return {
    listChatPrefs: vi.fn(async () => []),
    putChatPref: vi.fn(async () => null),
  } as unknown as ChatPrefsApi;
}

function fakePins(): PinsApi {
  return {
    listPins: vi.fn(async () => []),
    pinMessage: vi.fn(async () => {
      throw new Error('no pins here');
    }),
    unpinMessage: vi.fn(async () => {
      throw new Error('no pins here');
    }),
  } as unknown as PinsApi;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('real store General-only group (T-0139)', () => {
  function setup(entries: ChatEntry[], deps: Partial<RealStoreDeps> = {}) {
    const api = fakeApi(entries);
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: fakePrefs(),
      pinsApi: fakePins(),
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => fakeCore() as never,
      ...deps,
    });
    return { store, api };
  }

  it('maps a General-only group with parsed topics to a topic row', async () => {
    // End to end through the real wire parse: the server's JSON flows
    // through `createChatApi` exactly like on the device, so this covers
    // the dropped-`topics` regression (a group whose only topic is General
    // maps to one topic row with pins, the info sheet and a group route).
    const body = {
      chats: [{ ...groupEntry(), topics: [topicWire()] }],
    };
    const response = new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const fetchImpl = vi.fn(async () => response);
    const { createChatApi } = await import('../lib/chat-api');
    const chatApi = createChatApi(async () => 't', fetchImpl as unknown as typeof fetch);
    const entries = await chatApi.getChats();
    const { store } = setup(entries);
    store.getState().start();
    await flush();

    const rows = store.getState().chats;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'general@rooms.galena.test',
      groupId: 'g1',
      groupTitle: 'Dev team',
    });
    expect(rows[0]?.topic?.isGeneral).toBe(true);
    store.getState().stop();
  });

  it('allows pinning in the General row once the detail loads', async () => {
    const parsed = parseTopic(topicWire());
    if (parsed === null) {
      throw new Error('test topic must parse');
    }
    const general: Topic = parsed;
    const { store } = setup([groupEntry({ topics: [general] })]);
    store.getState().start();
    await flush();

    expect(store.getState().canPin('general@rooms.galena.test')).toBe(true);
    store.getState().stop();
  });

  it('opens the group route from the chat list model for a General-only group', async () => {
    const parsed = parseTopic(topicWire());
    if (parsed === null) {
      throw new Error('test topic must parse');
    }
    const general: Topic = parsed;
    const { chatListModel } = await import('../lib/chat-list');
    const { store } = setup([groupEntry({ topics: [general] })]);
    store.getState().start();
    await flush();

    const model = chatListModel(store.getState().chats, { folder: 'all', search: '' });
    expect(model.rows).toEqual([{ kind: 'group', groupId: 'g1' }]);
    store.getState().stop();
  });
});

describe('real store group detail fetch count (T-0139)', () => {
  it('fetches the group detail once for boot, chat open and group screen mount', async () => {
    // The reported symptom: opening a chat and then the group screen fired
    // a forced GET per mount (openChat + chat screen effect + group screen
    // effect). Mounts now use the cached path and member-name loads share
    // the in-flight detail, so the whole flow costs only the boot GETs;
    // only explicit refreshes fetch again.
    const wires = [
      topicWire({
        id: 't-g',
        name: 'General',
        isGeneral: true,
        chatJid: 'general@rooms.galena.test',
      }),
      topicWire({
        id: 't-1',
        name: 'One',
        isGeneral: false,
        chatJid: 't-1@rooms.galena.test',
      }),
      topicWire({
        id: 't-2',
        name: 'Two',
        isGeneral: false,
        chatJid: 't-2@rooms.galena.test',
      }),
    ];
    const parsed: Topic[] = [];
    for (const wire of wires) {
      const topic = parseTopic(wire);
      if (topic === null) {
        throw new Error('test topic must parse');
      }
      parsed.push(topic);
    }
    const entries: ChatEntry[] = [groupEntry({ topics: parsed })];
    const api = {
      ...(fakeApi(entries) as unknown as ChatApi),
      getGroup: vi.fn(async (groupId: string) => ({
        id: groupId,
        title: 'Dev team',
        createdBy: 'u-me',
        members: [
          { userId: 'u-me', name: 'Me', role: 'admin' as const, roles: [] },
          { userId: 'u-ana', name: 'Ana', role: 'member' as const, roles: [] },
        ],
        ais: [],
      })),
    };
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: fakePrefs(),
      pinsApi: fakePins(),
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => fakeCore() as never,
    });
    const getGroup = api.getGroup as unknown as { mock: { calls: string[] } };
    store.getState().start();
    await flush();
    // Boot loads the detail once per group: joinGroups + member-name loads
    // fire together per topic row, but the in-flight waiter collapses them
    // into the boot GETs. The exact boot count is an implementation detail
    // — what matters is no new fetch afterwards.
    const afterBoot = getGroup.mock.calls.length;
    expect(afterBoot).toBeGreaterThan(0);

    // Opening two topics of the same group: the deduped path, no new fetch.
    store.getState().openChat('t-1@rooms.galena.test');
    await flush();
    store.getState().openChat('t-2@rooms.galena.test');
    await flush();
    expect(getGroup.mock.calls.length).toBe(afterBoot);

    // The chat screen mount and the group screen mount: the cached path, no
    // new fetch (both used to force one GET per mount).
    store.getState().ensureGroupDetail('g1');
    await flush();
    store.getState().ensureGroupDetail('g1');
    await flush();
    expect(getGroup.mock.calls.length).toBe(afterBoot);

    // Explicit user refreshes still force one fetch each.
    store.getState().refreshGroupDetail('g1');
    await flush();
    store.getState().refreshGroupDetail('g1');
    await flush();
    expect(getGroup.mock.calls.length).toBe(afterBoot + 2);
    store.getState().stop();
  });
});
