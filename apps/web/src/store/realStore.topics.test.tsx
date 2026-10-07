import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Occupant, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
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
    chatJid: 'team@rooms.zilar.test',
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
    chatJid: 'bug-topic@rooms.zilar.test',
    kind: 'bug',
    status: 'in_progress',
    isGeneral: false,
  });
}

function groupEntry(overrides: Record<string, unknown> = {}): ChatEntry {
  return {
    kind: 'group',
    chatJid: 'team@rooms.zilar.test',
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
    me: () => 'me@zilar.test',
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
      putUrl: 'http://upload.zilar.test/put/1',
      getUrl: 'http://upload.zilar.test/get/1/voice.m4a',
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
      email: 'me@zilar.test',
      name: 'Me',
      image: null,
      jid: 'me@zilar.test',
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
      jid: 'me@zilar.test',
      token: 'tok',
      expiresAt: '2026-09-28T12:05:00Z',
      service: 'ws://x',
      domain: 'zilar.test',
      mucDomain: 'rooms.zilar.test',
    })),
    createGroup: vi.fn(nope),
    createInvite: vi.fn(nope),
    createGroupInviteLink: vi.fn(nope),
    listGroupInviteLinks: vi.fn(async () => []),
    listGroupMembers: vi.fn(async () => []),
    revokeGroupInviteLink: vi.fn(async () => {}),
    previewJoinLink: vi.fn(nope),
    joinByLink: vi.fn(nope),
    changeGroupMemberRole: vi.fn(nope),
    removeGroupMember: vi.fn(nope),
    setGroupVisibility: vi.fn(nope),
    searchDirectory: vi.fn(async () => ({ entries: [], next: null })),
    lookupGroupByHandle: vi.fn(nope),
    joinPublicGroup: vi.fn(nope),
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
    setTopicRoles: vi.fn(nope),
    setMembersCanCreateTopics: vi.fn(nope),
    listChatPrefs: vi.fn(async () => []),
    getChatBackgroundDefault: vi.fn(async () => ({
      backgroundPreset: null,
      backgroundImageId: null,
      backgroundDim: null,
    })),
    putChatBackgroundDefault: vi.fn(async (input) => input),
    putChatPref: vi.fn(async () => null),
    listPins: vi.fn(async () => []),
    listChatMedia: vi.fn(async () => ({ items: [], next: null })),
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
      'team@rooms.zilar.test',
      'bug-topic@rooms.zilar.test',
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
      chatJid: 'team@rooms.zilar.test',
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
    expect(rows.map((row) => row.id)).toEqual(['team@rooms.zilar.test']);
  });

  it('summariesFor carries the channel fields onto the feed row', () => {
    const rows = summariesFor(
      groupEntry({
        chatKind: 'channel',
        subscriberCount: 120,
        description: 'Ship notes',
        role: 'member',
        topics: [topic()],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      chatKind: 'channel',
      subscriberCount: 120,
      description: 'Ship notes',
      myRole: 'member',
    });
  });

  it('boot joins every visible topic room', async () => {
    const { xmpp } = await setup();
    expect(xmpp.joined).toContain('team@rooms.zilar.test');
    expect(xmpp.joined).toContain('bug-topic@rooms.zilar.test');
  });

  it('refresh on invite adds a topic and keeps previews and unread', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
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
            chatJid: 'new-topic@rooms.zilar.test',
            isGeneral: false,
          }),
        ],
      }),
    ]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    const ids = store.getState().chats.map((chat) => chat.id);
    expect(ids).toContain('new-topic@rooms.zilar.test');
    expect(store.getState().chats.find((chat) => chat.id === bugId)?.unread).toBe(3);
  });

  it('a topic that disappears while open navigates to General with a notice', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    store.getState().openChat(bugId);
    expect(store.getState().activeChatId).toBe(bugId);
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    expect(store.getState().activeChatId).toBe('team@rooms.zilar.test');
    expect(store.getState().topicNotice?.chatId).toBe('team@rooms.zilar.test');
    expect(store.getState().topicNotice?.message).not.toContain('Checkout');
  });

  it('an archived open topic navigates away at once after a patch', async () => {
    // Fix 1's store half: patching `archived: true` drops the row from the
    // visible list immediately (the server excludes archived topics), so the
    // header can navigate without waiting for the 60 s poll.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
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
    const bugId = 'bug-topic@rooms.zilar.test';
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
    await expect(store.getState().refreshGeneralTopic('g1')).resolves.toBe('team@rooms.zilar.test');
  });

  it('a failed member removal (403) keeps the user in the topic with an inline error', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
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
    const bugId = 'bug-topic@rooms.zilar.test';
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
    const bugId = 'bug-topic@rooms.zilar.test';
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
    const bugId = 'bug-topic@rooms.zilar.test';
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

  it('a last-seat leave 404 swallows only when the topic really disappears', async () => {
    // T-0146: the 404 swallow must only treat "the topic is gone" as
    // success. The DELETE 404s (last seat → archived) and the refreshed
    // list no longer has the row: `leaveTopic` resolves, so the panel
    // navigates away.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    store.getState().openChat(bugId);
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.removeTopicMember as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(404, 'not_found', 'Topic not found'),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    await expect(store.getState().leaveTopic(bugId)).resolves.toBeUndefined();
  });

  it('a non-membership leave 404 rethrows when the topic is still listed', async () => {
    // T-0146: the same 404 code for "you are not a member" must show the
    // normal error instead of navigating away. The DELETE 404s but the
    // refreshed list still has the row: `leaveTopic` rejects with the
    // original error.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    store.getState().openChat(bugId);
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    (apiMock.removeTopicMember as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(404, 'not_found', 'That user is not a member of this topic'),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([groupEntry()]);
    await expect(store.getState().leaveTopic(bugId)).rejects.toThrow(/not a member/);
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(true);
  });

  it('the refresh interval is 60 s', () => {
    expect(TOPIC_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it('setTopicRoles calls the API with the topic id and refreshes the row (T-0116)', async () => {
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const { topicSchema } = await import('@/lib/api');
    const updated = topicSchema.parse({
      ...bugTopic(),
      visibility: 'private',
      roles: [{ id: 'role-designers', name: 'Designers', memberCount: 2 }],
      approverRole: { id: 'role-designers', name: 'Designers' },
    });
    (apiMock.setTopicRoles as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic(), { ...bugTopic(), visibility: 'private' }] }),
    ]);
    await store.getState().setTopicRoles(bugId, {
      roleIds: ['role-designers'],
      approverRoleId: 'role-designers',
    });
    expect(apiMock.setTopicRoles).toHaveBeenCalledWith('t-bug', {
      roleIds: ['role-designers'],
      approverRoleId: 'role-designers',
    });
  });

  it('navigating away first clears a pending quiet-archive mark', async () => {
    // T-0141: archiving the open topic marks it quiet so the disappearance
    // refresh moves silently — but if the user opens another chat before
    // the refresh resolves, the mark must go. Discriminator: after the
    // hop, stranding a topic genuinely must still raise its notice. With
    // the leaked mark the final notice would stay silent.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    const generalId = 'team@rooms.zilar.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const { topicSchema } = await import('@/lib/api');
    (apiMock.patchTopic as ReturnType<typeof vi.fn>).mockResolvedValue(
      topicSchema.parse({ ...bugTopic(), archived: true }),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([groupEntry()]);
    store.getState().openChat(bugId);
    await store.getState().patchTopic(bugId, { archived: true });
    // Away before the refresh resolves: the quiet mark for the bug topic
    // must be dropped by the hop to General.
    store.getState().openChat(generalId);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    // The bug topic is back on the server; open it and lose it genuinely.
    store.getState().openChat(bugId);
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    expect(store.getState().activeChatId).toBe(generalId);
    expect(store.getState().topicNotice?.message).toBe('This topic is no longer available.');
  });

  it('a self-archive with no General consumes the quiet mark', async () => {
    // Fix 2: archiving the open topic when General is absent navigates to
    // `/`. `applyTopicRow` already dropped the row, so the stranded-open
    // flow must still consume the quiet mark — otherwise it leaks and
    // would silence the notice for a later, unrelated removal.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const { topicSchema } = await import('@/lib/api');
    (apiMock.patchTopic as ReturnType<typeof vi.fn>).mockResolvedValue(
      topicSchema.parse({ ...bugTopic(), archived: true }),
    );
    // No General anywhere: the refreshed list has no topic from this group.
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    store.getState().openChat(bugId);
    await store.getState().patchTopic(bugId, { archived: true });
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    expect(store.getState().activeChatId).toBeUndefined();
  });

  it('a leaked quiet mark does not silence a genuine later removal', async () => {
    // Companion to the test above: after a self-archive with no General,
    // stranding a *topic* row must still raise the notice.
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const { topicSchema } = await import('@/lib/api');
    (apiMock.patchTopic as ReturnType<typeof vi.fn>).mockResolvedValue(
      topicSchema.parse({ ...bugTopic(), archived: true }),
    );
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    store.getState().openChat(bugId);
    await store.getState().patchTopic(bugId, { archived: true });
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    // Re-open the bug topic (list has it again), then lose it genuinely.
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([groupEntry()]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    store.getState().openChat(bugId);
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockResolvedValue([
      groupEntry({ topics: [topic()] }),
    ]);
    store.getState().refreshChats();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await flush();
    expect(store.getState().activeChatId).toBe('team@rooms.zilar.test');
    expect(store.getState().topicNotice?.message).toBe('This topic is no longer available.');
  });

  it('a superseded row re-check rejects instead of reading stale state', async () => {
    // Fix 5: if `stop()`/`start()` (or a retry) bumps the generation while
    // the re-check's fetch is in flight, the refresh is stale — rejecting
    // keeps the panel from reading the untouched list as "topic alive".
    const { store, api } = await setup();
    const bugId = 'bug-topic@rooms.zilar.test';
    const apiMock = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (apiMock.getChats as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return [groupEntry()];
    });
    const recheck = store.getState().refreshTopicRow(bugId, 't-bug');
    store.getState().stop();
    release?.();
    await expect(recheck).rejects.toThrow(/superseded/);
    // Untouched: the row is still there and no navigation happened.
    expect(store.getState().chats.some((chat) => chat.id === bugId)).toBe(true);
  });
});
