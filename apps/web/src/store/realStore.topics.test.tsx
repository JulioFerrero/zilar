import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@galena/xmpp-core';
import {
  TOPIC_REFRESH_INTERVAL_MS,
  createRealChatStore,
  summariesFor,
  type ApiClient,
  type StorageLike,
} from './realStore';
import { ApiError } from '@/lib/api';
import type { ChatEntry } from '@/lib/api';

vi.mock('@/lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => ({})) },
}));

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

function topic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-general',
    groupId: 'g1',
    name: 'General',
    glyph: 'G',
    chatJid: 'team@rooms.galena.test',
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
  };
}

function bugTopic(): Record<string, unknown> {
  return topic({
    id: 't-bug',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 'bug-topic@rooms.galena.test',
    kind: 'bug',
    status: 'in_progress',
    isGeneral: false,
  });
}

function groupEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'group',
    chatJid: 'team@rooms.galena.test',
    title: 'Team',
    groupId: 'g1',
    memberCount: 3,
    role: 'member',
    topics: [topic(), bugTopic()],
    ...overrides,
  } as ChatEntry;
}

function fakeXmpp(): {
  core: XmppCore;
  joined: string[];
  history: Record<string, ChatMessage[]>;
  emit: (event: string, payload: unknown) => void;
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const joined: string[] = [];
  const history: Record<string, ChatMessage[]> = {};
  const core = {
    status: () => 'online' as const,
    me: () => 'me@galena.test',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    joinRoom: vi.fn(async (roomJid: string) => {
      joined.push(roomJid);
    }),
    leaveRoom: vi.fn(async () => {}),
    occupants: vi.fn((): Occupant[] => []),
    sendMessage: vi.fn(async () => ({ id: 'srv-1' })),
    sendReactions: vi.fn(async () => {}),
    sendCorrection: vi.fn(async () => ({ id: 'edit-1' })),
    sendRetraction: vi.fn(async () => {}),
    requestUploadSlot: vi.fn(async () => ({
      putUrl: 'http://upload.galena.test/put/1',
      getUrl: 'http://upload.galena.test/get/1/voice.m4a',
      headers: {},
    })),
    loadHistory: vi.fn(async (chatJid: string) => ({
      messages: history[chatJid] ?? [],
      complete: true,
      first: undefined,
    })),
    sendTyping: vi.fn(),
    markDisplayed: vi.fn(),
    on: ((event: string, callback: (payload: unknown) => void) => {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
      };
    }) as unknown as XmppCore['on'],
  } as unknown as XmppCore;
  return {
    core,
    joined,
    history,
    emit: (event, payload) => {
      for (const callback of listeners.get(event) ?? []) {
        callback(payload);
      }
    },
  };
}

function topicApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const nope = async (): Promise<never> => {
    throw new Error('not implemented');
  };
  return {
    getMe: vi.fn(async () => ({
      id: 'u-me',
      email: 'me@galena.test',
      name: 'Me',
      image: null,
      jid: 'me@galena.test',
    })),
    getChats: vi.fn(async () => [groupEntry()]),
    getContacts: vi.fn(async () => []),
    getGroup: vi.fn(async () => ({
      id: 'g1',
      title: 'Team',
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
    createGroup: vi.fn(nope),
    createInvite: vi.fn(nope),
    createGroupInviteLink: vi.fn(nope),
    listGroupInviteLinks: vi.fn(async () => []),
    revokeGroupInviteLink: vi.fn(async () => {}),
    previewJoinLink: vi.fn(nope),
    joinByLink: vi.fn(nope),
    listAis: vi.fn(async () => []),
    addGroupAi: vi.fn(nope),
    removeGroupAi: vi.fn(nope),
    createTopic: vi.fn(nope),
    getTopic: vi.fn(nope),
    patchTopic: vi.fn(nope),
    archiveTopic: vi.fn(nope),
    listGroupTopics: vi.fn(async () => []),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(nope),
    removeTopicMember: vi.fn(nope),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(nope),
    removeTopicAi: vi.fn(nope),
    setMembersCanCreateTopics: vi.fn(nope),
    listChatPrefs: vi.fn(async () => []),
    putChatPref: vi.fn(async () => null),
    listPins: vi.fn(async () => []),
    pinMessage: vi.fn(nope),
    unpinMessage: vi.fn(async () => {}),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setup(overrides: Partial<ApiClient> = {}) {
  const api = topicApi(overrides);
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

describe('topics store mapping (T-0111)', () => {
  it('summariesFor maps each topic to its own chat; General keeps the old id', () => {
    const rows = summariesFor(groupEntry());
    expect(rows.map((row) => row.id)).toEqual([
      'team@rooms.galena.test',
      'bug-topic@rooms.galena.test',
    ]);
    const general = rows[0];
    expect(general?.topic?.isGeneral).toBe(true);
    expect(general?.groupId).toBe('g1');
    expect(general?.groupTitle).toBe('Team');
    const bug = rows[1];
    expect(bug?.title).toBe('Checkout bug');
    expect(bug?.topic?.kind).toBe('bug');
    expect(bug?.topic?.status).toBe('in_progress');
  });

  it('summariesFor keeps one row for a group without topics (older server)', () => {
    const rows = summariesFor({
      kind: 'group',
      chatJid: 'team@rooms.galena.test',
      title: 'Team',
      groupId: 'g1',
      memberCount: 3,
      role: 'member',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.topic).toBeUndefined();
  });

  it('summariesFor drops archived topics', () => {
    const rows = summariesFor(groupEntry({ topics: [topic(), { ...bugTopic(), archived: true }] }));
    expect(rows.map((row) => row.id)).toEqual(['team@rooms.galena.test']);
  });

  it('boot joins every visible topic room', async () => {
    const { xmpp } = await setup();
    expect(xmpp.joined).toContain('team@rooms.galena.test');
    expect(xmpp.joined).toContain('bug-topic@rooms.galena.test');
  });

  it('refresh on invite adds a topic and keeps previews and unread', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    store
      .getState()
      .chats.filter((chat) => chat.id === bugId)
      .forEach(() => {});
    // Simulate unread on the bug topic, then a refresh that adds a topic.
    store.setState((state) => ({
      chats: state.chats.map((chat) => (chat.id === bugId ? { ...chat, unread: 3 } : chat)),
    }));
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({
        topics: [
          topic(),
          bugTopic(),
          topic({
            id: 't-new',
            name: 'New topic',
            glyph: 'N',
            chatJid: 'new-topic@rooms.galena.test',
            isGeneral: false,
          }),
        ],
      }),
    ]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    const ids = store.getState().chats.map((chat) => chat.id);
    expect(ids).toContain('new-topic@rooms.galena.test');
    expect(store.getState().chats.find((chat) => chat.id === bugId)?.unread).toBe(3);
  });

  it('a topic that disappears while open navigates to General with a notice', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    store.getState().openChat(bugId);
    expect(store.getState().activeChatId).toBe(bugId);
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    expect(store.getState().activeChatId).toBe('team@rooms.galena.test');
    expect(store.getState().topicNotice?.chatId).toBe('team@rooms.galena.test');
    expect(store.getState().topicNotice?.message).not.toContain('Checkout');
  });

  it('an archived open topic navigates away at once after a patch', async () => {
    // Fix 1's store half: patching `archived: true` drops the row from the
    // visible list immediately (the server excludes archived topics), so the
    // header can navigate without waiting for the 60 s poll.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const { topicSchema } = await import('@/lib/api');
    (apiMock.patchTopic as ReturnType<typeof vi.fn>).mockResolvedValue(
      topicSchema.parse({ ...bugTopic(), archived: true }),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    await store.getState().patchTopic(bugId, { archived: true });
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(false);
  });

  it('a deliberate self-archive moves without the "no longer available" notice', async () => {
    // Finding 4: archiving the open topic from its own header moves to
    // General silently. The store half: the self-archive drops the row and
    // marks the open chat quiet, so the stranded-open check below resolves
    // to General with no notice. (The full removed-while-open trip with a
    // notice is covered by the pre-existing test above.)
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const { topicSchema } = await import('@/lib/api');
    (apiMock.patchTopic as ReturnType<typeof vi.fn>).mockResolvedValue(
      topicSchema.parse({ ...bugTopic(), archived: true }),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    store.getState().openChat(bugId);
    await store.getState().patchTopic(bugId, { archived: true });
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(false);
    // The open chat is stranded on a missing row; the quiet mark (set by
    // the self-archive) is consumed by the very next refresh.
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    expect(store.getState().topicNotice).toBeUndefined();
  });

  it('refreshGeneralTopic awaits a real refresh, not the debounce schedule', async () => {
    // Finding 3: the General row is absent locally and appears only in the
    // refreshed list. Resolving it proves the action awaited the fetch.
    const { store, api } = await setup();
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    store.setState((state) => ({
      chats: state.chats.filter((chat) => chat.topic?.isGeneral !== true),
    }));
    expect(store.getState().chats.some((chat) => chat.topic?.isGeneral === true)).toBe(false);
    await expect(store.getState().refreshGeneralTopic('g1')).resolves.toBe(
      'team@rooms.galena.test',
    );
  });

  it('a failed member removal (403) keeps the user in the topic with an inline error', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    store.getState().openChat(bugId);
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const getChats = apiMock.getChats as ReturnType<typeof vi.fn>;
    getChats.mockClear();
    (apiMock.removeTopicMember as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(403, 'forbidden', 'Only a manager or the member themselves can remove a member'),
    );
    await expect(store.getState().removeTopicMember(bugId, 'u-ana')).rejects.toThrow(
      /manager or the member/,
    );
    // The row stays: no refresh removed anything and the open chat is untouched.
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(true);
    expect(store.getState().activeChatId).toBe(bugId);
    expect(getChats).not.toHaveBeenCalled();
  });

  it('a failed member removal (network) keeps the user in the topic', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    store.getState().openChat(bugId);
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const getChats = apiMock.getChats as ReturnType<typeof vi.fn>;
    getChats.mockClear();
    (apiMock.removeTopicMember as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(0, 'network_error', 'Could not reach the server'),
    );
    await expect(store.getState().removeTopicMember(bugId, 'u-ana')).rejects.toThrow(
      /Could not reach/,
    );
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(true);
    expect(store.getState().activeChatId).toBe(bugId);
    expect(getChats).not.toHaveBeenCalled();
  });

  it('a failed removal re-check throws on refresh failure instead of reading stale state', async () => {
    // Finding 3: the DELETE 404s, then the list refresh fails. The
    // re-check must throw (so the panel shows the inline removal error),
    // never resolve "alive" from the untouched stale list.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.removeTopicMember as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(404, 'not_found', 'That user is not a member of this topic'),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(0, 'network_error', 'Could not reach the server'),
    );
    await expect(store.getState().removeTopicMember(bugId, 'u-ana')).rejects.toThrow(
      /not a member/,
    );
    await expect(store.getState().refreshTopicRow(bugId, 't-bug')).rejects.toThrow(
      /Could not reach/,
    );
    // The row is untouched: no silent drop, no navigation decision.
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(true);
  });

  it('a 404 removal re-checks the row: alive topic stays, gone topic reports true', async () => {
    // The server 404s both for a non-member and for a gone topic, so
    // `refreshTopicRow` — not the 404 alone — decides. First with the row
    // still listed (stale member list): not gone.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.galena.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.removeTopicMember as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(404, 'not_found', 'That user is not a member of this topic'),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([groupEntry()]);
    await expect(store.getState().removeTopicMember(bugId, 'u-ana')).rejects.toThrow(
      /not a member/,
    );
    await expect(store.getState().refreshTopicRow(bugId, 't-bug')).resolves.toBe(false);
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(true);
    // Then with the row gone from the list (last member removed → archived).
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    await expect(store.getState().refreshTopicRow(bugId, 't-bug')).resolves.toBe(true);
  });

  it('the refresh interval is 60 s', () => {
    expect(TOPIC_REFRESH_INTERVAL_MS).toBe(60_000);
  });
});
