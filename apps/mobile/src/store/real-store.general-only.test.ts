import type { ChatEntry } from '../lib/chat-api';
import type { ChatApi } from '../lib/chat-api';
import type { ChatPrefsApi } from '../lib/chat-prefs-api';
import type { PinsApi } from '../lib/pins-api';
import type { TopicsApi } from '../lib/topics-api';
import type { XmppCore } from '@zilar/xmpp-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { parseTopic, type Topic } from '../lib/topics-api';

import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApiWithMembers, fakeAppState } from './test-support';
import { flushTasks as flush } from '@/test/wait';

function topicWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-g',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: 'general@rooms.zilar.test',
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
    chatJid: 'general@rooms.zilar.test',
    title: 'Dev team',
    groupId: 'g1',
    memberCount: 6,
    role: 'member',
    ...overrides,
  } as ChatEntry;
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

describe('real store General-only group (T-0139)', () => {
  function setup(entries: ChatEntry[], deps: Partial<RealStoreDeps> = {}) {
    const api = fakeApiWithMembers(entries);
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: fakePrefs(),
      pinsApi: fakePins(),
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => createFakeXmppCore(),
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
      id: 'general@rooms.zilar.test',
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

    expect(store.getState().canPin('general@rooms.zilar.test')).toBe(true);
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

    const model = chatListModel(store.getState().chats, { folder: undefined, search: '' });
    expect(model.rows).toEqual([{ kind: 'group', groupId: 'g1' }]);
    store.getState().stop();
  });
});

describe('real store group detail fetch count (T-0147)', () => {
  function detailApi(entries: ChatEntry[]) {
    return {
      ...(fakeApiWithMembers(entries) as unknown as ChatApi),
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
  }

  function parseWires(wires: Record<string, unknown>[]): Topic[] {
    const parsed: Topic[] = [];
    for (const wire of wires) {
      const topic = parseTopic(wire);
      if (topic === null) {
        throw new Error('test topic must parse');
      }
      parsed.push(topic);
    }
    return parsed;
  }

  function groupCalls(getGroup: unknown): number {
    return (getGroup as { mock: { calls: unknown[] } }).mock.calls.length;
  }

  function setupCold(entries: ChatEntry[], core?: XmppCore) {
    const api = detailApi(entries);
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: fakePrefs(),
      pinsApi: fakePins(),
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => core ?? createFakeXmppCore(),
    });
    return { store, api };
  }

  // Boots the store to the cold state: the chat list is loaded but no group
  // detail has ever fetched (the XMPP connect fails, so `joinGroups` never
  // runs). Mirrors a deep link opened before the socket is up. `entries`
  // may be empty for the roster-push test, which lands its rows later.
  async function bootCold(entries: ChatEntry[], core?: XmppCore) {
    const { store, api } = setupCold(entries, core);
    store.getState().start();
    await flush();
    await flush();
    expect(store.getState().chats).toHaveLength(entries.length === 0 ? 0 : 1);
    expect(groupCalls(api.getGroup)).toBe(0);
    return { store, api };
  }

  function failingConnectCore(): XmppCore {
    return createFakeXmppCore({
      connect: async () => {
        throw new Error('offline');
      },
    });
  }

  it('opens a cold chat with one group GET', async () => {
    // T-0147: a cold open fired two GETs (the members fallback before the
    // detail load). The detail starts first and the members fallback fills
    // the detail cache, so the open costs exactly one.
    const parsed = parseWires([
      topicWire({
        id: 't-g',
        name: 'General',
        isGeneral: true,
        chatJid: 'general@rooms.zilar.test',
      }),
    ]);
    const { store, api } = await bootCold([groupEntry({ topics: parsed })], failingConnectCore());

    // Cold open: the detail has never fetched — one GET total.
    store.getState().openChat('general@rooms.zilar.test');
    await flush();
    expect(groupCalls(api.getGroup)).toBe(1);
    expect(store.getState().groupDetail('g1')).toBeDefined();
    store.getState().stop();
  });

  it('serves a 5-topic roster push with one group GET', async () => {
    // T-0147: an invite/roster push for an N-topic group fanned out N GETs
    // (one fallback per row). The roster path dedupes per group id and the
    // fallback fills the detail cache, so five rows cost exactly one.
    const parsed = parseWires(
      [0, 1, 2, 3, 4].map((n) =>
        topicWire({
          id: `t-${n}`,
          name: `Topic ${n}`,
          isGeneral: false,
          chatJid: `t-${n}@rooms.zilar.test`,
        }),
      ),
    );
    const { store, api } = await bootCold([], failingConnectCore());

    // The push is the first thing the store hears of this group: five fresh
    // rows land at once (the invite/roster path). The core object exists
    // (connect failed, but adoption only needs the handle), so the adoption
    // path joins each room and loads member names — five rows, one group,
    // one shared GET.
    vi.mocked(api.getChats).mockResolvedValue([groupEntry({ topics: parsed })]);
    await store.getState().reloadChats();
    await flush();
    await flush();
    expect(store.getState().chats).toHaveLength(5);
    expect(groupCalls(api.getGroup)).toBe(1);
    store.getState().stop();
  });

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
        chatJid: 'general@rooms.zilar.test',
      }),
      topicWire({
        id: 't-1',
        name: 'One',
        isGeneral: false,
        chatJid: 't-1@rooms.zilar.test',
      }),
      topicWire({
        id: 't-2',
        name: 'Two',
        isGeneral: false,
        chatJid: 't-2@rooms.zilar.test',
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
      ...(fakeApiWithMembers(entries) as unknown as ChatApi),
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
      createXmpp: () => createFakeXmppCore(),
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
    store.getState().openChat('t-1@rooms.zilar.test');
    await flush();
    store.getState().openChat('t-2@rooms.zilar.test');
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
