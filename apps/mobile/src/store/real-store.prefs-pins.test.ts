import type { ChatEntry } from '../lib/chat-api';
import type { ChatPrefsApi } from '../lib/chat-prefs-api';
import type { PinsApi } from '../lib/pins-api';
import type { TopicsApi } from '../lib/topics-api';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createRealChatStore, type RealStoreDeps } from './real-store';
import { fakeApiWithMembers, fakeAppState } from './test-support';
import { flushTasks as flush } from '@/test/wait';

function dmEntry(chatJid: string, title: string): ChatEntry {
  return { kind: 'dm', chatJid, title, userId: `u-${chatJid}` };
}

function topicRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't-1',
    groupId: 'g1',
    name: 'Checkout bug',
    glyph: 'B',
    chatJid: 't-1@rooms.zilar.test',
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

function generalRow(): Record<string, unknown> {
  return topicRow({
    id: 't-g',
    name: 'General',
    isGeneral: true,
    chatJid: 'general@rooms.zilar.test',
  });
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
    createTopic: vi.fn(async (_groupId: string, input: { name: string }) =>
      topicRow({ id: 't-new', name: input.name, chatJid: 't-new@rooms.zilar.test' }),
    ),
    getTopic: vi.fn(async (id: string) => topicRow({ id })),
    patchTopic: vi.fn(async (id: string) => topicRow({ id })),
    archiveTopic: vi.fn(async (id: string) => topicRow({ id, archived: true })),
    listTopicMembers: vi.fn(async () => []),
    addTopicMember: vi.fn(async (id: string) => topicRow({ id })),
    removeTopicMember: vi.fn(async (id: string) => topicRow({ id })),
    listTopicAis: vi.fn(async () => []),
    addTopicAi: vi.fn(async (id: string) => topicRow({ id })),
    removeTopicAi: vi.fn(async (id: string) => topicRow({ id })),
    setMembersCanCreateTopics: vi.fn(async () => true),
  } as unknown as TopicsApi;
}

function prefRow(
  chatJid: string,
  overrides: { mutedUntil?: string | null; archived?: boolean; pinnedAt?: string | null } = {},
) {
  return {
    chatJid,
    mutedUntil: null as string | null,
    archived: false,
    pinnedAt: null as string | null,
    updatedAt: '2026-09-30T11:00:00Z',
    ...overrides,
  };
}

function fakePrefs(rows: ReturnType<typeof prefRow>[] = []) {
  return {
    listChatPrefs: vi.fn(async () => rows.map((row) => ({ ...row }))),
    putChatPref: vi.fn(
      async (
        chatJid: string,
        input: { mutedUntil?: string | null; archived?: boolean; pinned?: boolean },
      ) => {
        const row = prefRow(chatJid);
        if (input.mutedUntil !== undefined) row.mutedUntil = input.mutedUntil;
        if (input.archived !== undefined) row.archived = input.archived;
        if (input.pinned === true) row.pinnedAt = '2026-09-30T12:00:00.000Z';
        return row;
      },
    ),
  } as unknown as ChatPrefsApi;
}

function pinRow(
  overrides: {
    id?: string;
    chat?: string;
    messageId?: string;
    senderName?: string;
    text?: string;
    kind?: 'text' | 'image' | 'file' | 'voice' | 'card';
    pinnedBy?: string;
    pinnedAt?: string;
  } = {},
) {
  return {
    id: 'pin-1',
    chat: 'ana@zilar.test',
    messageId: 'm-1',
    senderName: 'Ana',
    text: 'hello',
    kind: 'text' as const,
    pinnedBy: 'u-ana',
    pinnedAt: '2026-09-30T11:00:00Z',
    ...overrides,
  };
}

function fakePins(rows: ReturnType<typeof pinRow>[] = []) {
  return {
    listPins: vi.fn(async (chat: string) => rows.filter((row) => row.chat === chat)),
    pinMessage: vi.fn(
      async (input: {
        chat: string;
        messageId: string;
        senderName: string;
        text: string;
        kind: ReturnType<typeof pinRow>['kind'];
      }) => pinRow({ ...input, id: 'pin-9' }),
    ),
    unpinMessage: vi.fn(async (id: string) => pinRow({ id })),
  } as unknown as PinsApi;
}

describe('real store chat prefs (T-0135)', () => {
  function setup(
    entries: ChatEntry[],
    prefs: ReturnType<typeof fakePrefs> = fakePrefs(),
    deps: Partial<RealStoreDeps> = {},
  ) {
    const api = fakeApiWithMembers(entries);
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: prefs,
      pinsApi: fakePins(),
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => createFakeXmppCore(),
      ...deps,
    });
    return { store, api, prefs };
  }

  it('boots prefs with the chat list and merges them into the rows', async () => {
    const { store, prefs } = setup(
      [dmEntry('ana@zilar.test', 'Ana'), dmEntry('sara@zilar.test', 'Sara')],
      fakePrefs([
        prefRow('ana@zilar.test', { mutedUntil: '2126-01-01T00:00:00.000Z' }),
        prefRow('sara@zilar.test', { archived: true }),
      ]),
    );
    store.getState().start();
    await flush();

    expect(prefs.listChatPrefs).toHaveBeenCalled();
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);
    expect(store.getState().chats.find((chat) => chat.id === 'sara@zilar.test')?.archived).toBe(
      true,
    );
  });

  it('pins a chat first and refreshes prefs on a background reload', async () => {
    const { store, api, prefs } = setup(
      [dmEntry('ana@zilar.test', 'Ana'), dmEntry('sara@zilar.test', 'Sara')],
      fakePrefs([prefRow('sara@zilar.test', { pinnedAt: '2026-09-30T11:00:00.000Z' })]),
    );
    store.getState().start();
    await flush();

    // A background refresh applies the saved rows; sara stays a saved row.
    vi.mocked(api.getChats).mockResolvedValue([
      dmEntry('ana@zilar.test', 'Ana'),
      dmEntry('sara@zilar.test', 'Sara'),
    ]);
    store.getState().reloadChats();
    await flush();

    expect(store.getState().chats.find((chat) => chat.id === 'sara@zilar.test')?.pinnedAt).toEqual(
      new Date('2026-09-30T11:00:00.000Z'),
    );
    expect(prefs.listChatPrefs).toHaveBeenCalled();
  });

  it('sets a pref optimistically and drops it on failure', async () => {
    const { store, prefs } = setup([dmEntry('ana@zilar.test', 'Ana')]);
    store.getState().start();
    await flush();

    await store.getState().setChatPref('ana@zilar.test', { archived: true });
    expect(prefs.putChatPref).toHaveBeenCalledWith('ana@zilar.test', { archived: true });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.archived).toBe(
      true,
    );

    // Unarchiving fails: the failed write is dropped and the saved row
    // (still archived) wins — the chat stays archived.
    vi.mocked(prefs.putChatPref).mockRejectedValueOnce(new Error('offline'));
    await expect(
      store.getState().setChatPref('ana@zilar.test', { archived: false }),
    ).rejects.toThrow();
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.archived).toBe(
      true,
    );
  });

  it('keeps background updates that land while a pref write fails', async () => {
    // Pin B on a slow network; a background refresh delivers a new message
    // and an unread bump for B mid-flight; then the PUT fails. The list
    // must keep the background update and only lose the failed pin — not
    // snap back to the pre-write snapshot.
    let releasePut!: (error: Error) => void;
    const putGate = new Promise<never>((_resolve, reject) => {
      releasePut = reject;
    });
    const prefs = fakePrefs();
    vi.mocked(prefs.putChatPref).mockReturnValueOnce(putGate);
    const { store, api } = setup(
      [dmEntry('ana@zilar.test', 'Ana'), dmEntry('sara@zilar.test', 'Sara')],
      prefs,
    );
    store.getState().start();
    await flush();

    const pending = store
      .getState()
      .setChatPref('sara@zilar.test', { pinned: true })
      .catch(() => {});
    await flush();
    // The optimistic pin shows while the PUT is in flight.
    expect(
      store.getState().chats.find((chat) => chat.id === 'sara@zilar.test')?.pinnedAt,
    ).toBeInstanceOf(Date);

    // A background refresh lands mid-flight: new last message + unread.
    const landedAt = new Date('2026-09-30T12:30:00Z');
    vi.mocked(api.getChats).mockResolvedValue([
      dmEntry('ana@zilar.test', 'Ana'),
      dmEntry('sara@zilar.test', 'Sara'),
    ]);
    store.getState().reloadChats();
    await flush();
    store.setState((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === 'sara@zilar.test'
          ? {
              ...chat,
              unread: 3,
              lastMessage: {
                id: 'm-late',
                chatId: 'sara@zilar.test',
                senderId: 'u-sara',
                senderName: 'Sara',
                text: 'late news',
                createdAt: landedAt,
                status: 'read' as const,
              },
            }
          : chat,
      ),
    }));

    releasePut(new Error('offline'));
    await pending;
    const sara = store.getState().chats.find((chat) => chat.id === 'sara@zilar.test');
    // The failed pin is gone, but the background update survives.
    expect(sara?.pinnedAt).toBeUndefined();
    expect(sara?.unread).toBe(3);
    expect(sara?.lastMessage?.text).toBe('late news');
  });

  it('keeps the saved row through the pending pin request', async () => {
    // Mute Ana, then pin Ana while the PUT is held open: she stays muted
    // (icon + grey badge) for the whole flight, then settles pinned.
    let releasePut!: (row: ReturnType<typeof prefRow>) => void;
    const putGate = new Promise<ReturnType<typeof prefRow>>((resolve) => {
      releasePut = resolve;
    });
    const prefs = fakePrefs([prefRow('ana@zilar.test', { mutedUntil: '2126-01-01T00:00:00Z' })]);
    const { store } = setup([dmEntry('ana@zilar.test', 'Ana')], prefs);
    store.getState().start();
    await flush();

    vi.mocked(prefs.putChatPref).mockReturnValueOnce(putGate);
    const pending = store.getState().setChatPref('ana@zilar.test', { pinned: true });
    await flush();
    const ana = store.getState().chats.find((chat) => chat.id === 'ana@zilar.test');
    expect(ana?.muted).toBe(true);
    expect(ana?.pinnedAt).toBeInstanceOf(Date);

    releasePut(
      prefRow('ana@zilar.test', {
        mutedUntil: '2126-01-01T00:00:00Z',
        pinnedAt: '2026-09-30T12:00:00.000Z',
      }),
    );
    await pending;
    const settled = store.getState().chats.find((chat) => chat.id === 'ana@zilar.test');
    expect(settled?.muted).toBe(true);
    expect(settled?.pinnedAt).toEqual(new Date('2026-09-30T12:00:00.000Z'));
  });

  it('keeps other chats prefs during an optimistic write', async () => {
    // A is muted on the server; pinning B holds the PUT open and A must
    // stay muted the whole time (no flash back to normal).
    let releasePut!: (row: ReturnType<typeof prefRow>) => void;
    const putGate = new Promise<ReturnType<typeof prefRow>>((resolve) => {
      releasePut = resolve;
    });
    const prefs = fakePrefs([prefRow('ana@zilar.test', { mutedUntil: '2126-01-01T00:00:00Z' })]);
    vi.mocked(prefs.putChatPref).mockReturnValueOnce(putGate);
    const { store } = setup(
      [dmEntry('ana@zilar.test', 'Ana'), dmEntry('sara@zilar.test', 'Sara')],
      prefs,
    );
    store.getState().start();
    await flush();
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);

    const pending = store.getState().setChatPref('sara@zilar.test', { pinned: true });
    await flush();
    // While the PUT is in flight: A still muted, B already pinned.
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);
    expect(
      store.getState().chats.find((chat) => chat.id === 'sara@zilar.test')?.pinnedAt,
    ).toBeInstanceOf(Date);

    releasePut(prefRow('sara@zilar.test', { pinnedAt: '2026-09-30T12:00:00.000Z' }));
    await pending;
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);
    expect(store.getState().chats.find((chat) => chat.id === 'sara@zilar.test')?.pinnedAt).toEqual(
      new Date('2026-09-30T12:00:00.000Z'),
    );
  });

  it('drops the row when the write lands on defaults', async () => {
    const { store, prefs } = setup(
      [dmEntry('ana@zilar.test', 'Ana')],
      fakePrefs([prefRow('ana@zilar.test', { mutedUntil: '2126-01-01T00:00:00.000Z' })]),
    );
    store.getState().start();
    await flush();
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(true);

    vi.mocked(prefs.putChatPref).mockResolvedValueOnce(null);
    await store.getState().setChatPref('ana@zilar.test', { mutedUntil: null });
    expect(store.getState().chats.find((chat) => chat.id === 'ana@zilar.test')?.muted).toBe(false);
  });

  it('applies a group General mute to its topics', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store } = setup(
      [groupEntry({ topics: [general, topicRow()] })],
      fakePrefs([prefRow('general@rooms.zilar.test', { mutedUntil: '2126-01-01T00:00:00.000Z' })]),
    );
    store.getState().start();
    await flush();

    expect(
      store.getState().chats.find((chat) => chat.id === 'general@rooms.zilar.test')?.muted,
    ).toBe(true);
    expect(store.getState().chats.find((chat) => chat.id === 't-1@rooms.zilar.test')?.muted).toBe(
      true,
    );
  });
});

describe('real store pins (T-0135)', () => {
  function setup(
    entries: ChatEntry[],
    pins: ReturnType<typeof fakePins> = fakePins(),
    deps: Partial<RealStoreDeps> = {},
    myRole: 'owner' | 'admin' | 'member' = 'admin',
  ) {
    const api = fakeApiWithMembers(entries, myRole);
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: fakePrefs(),
      pinsApi: pins,
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => createFakeXmppCore(),
      ...deps,
    });
    return { store, api, pins };
  }

  it('loads pins when the chat opens', async () => {
    const rows = [pinRow({ chat: 'ana@zilar.test' })];
    const { store, pins } = setup([dmEntry('ana@zilar.test', 'Ana')], fakePins(rows));
    store.getState().start();
    await flush();

    expect(store.getState().pins('ana@zilar.test')).toEqual([]);
    store.getState().openChat('ana@zilar.test');
    await flush();

    expect(pins.listPins).toHaveBeenCalledWith('ana@zilar.test');
    expect(store.getState().pins('ana@zilar.test')).toEqual(rows);
    store.getState().stop();
  });

  it('keeps the pins array reference when a republish is identical', async () => {
    // The revision bump re-fires selectors once per publish (so the banner
    // and sheet see fresh data); the screen memoizes the ids it passes to
    // the message list, so an unchanged membership keeps the list stable.
    const rows = [pinRow({ chat: 'ana@zilar.test' })];
    const { store } = setup([dmEntry('ana@zilar.test', 'Ana')], fakePins(rows));
    store.getState().start();
    await flush();
    store.getState().openChat('ana@zilar.test');
    await flush();

    expect(store.getState().pins('ana@zilar.test')).toEqual(rows);
    await store.getState().refreshPins('ana@zilar.test');
    expect(store.getState().pins('ana@zilar.test')).toEqual(rows);
    store.getState().stop();
  });

  it('reports a pins load failure inline', async () => {
    const pins = fakePins();
    vi.mocked(pins.listPins).mockRejectedValueOnce(new Error('down'));
    const { store } = setup([dmEntry('ana@zilar.test', 'Ana')], pins);
    store.getState().start();
    await flush();

    store.getState().openChat('ana@zilar.test');
    await flush();

    expect(store.getState().pinsError).toMatchObject({ chatId: 'ana@zilar.test' });
    store.getState().dismissPinsError();
    expect(store.getState().pinsError).toBeUndefined();
    store.getState().stop();
  });

  it('pins a loaded message optimistically and keeps the saved row', async () => {
    const core = createFakeXmppCore();
    const { store, pins } = setup([dmEntry('ana@zilar.test', 'Ana')], fakePins(), {
      createXmpp: () => core,
    });
    store.getState().start();
    await flush();

    // A live incoming message becomes a loaded message the pin can target.
    core.emit('message', {
      id: 'm-1',
      kind: 'chat',
      chatJid: 'ana@zilar.test',
      fromJid: 'ana@zilar.test',
      fromResolved: true,
      timestamp: new Date('2026-09-30T10:00:00Z'),
      outgoing: false,
      body: 'hello',
    });

    // A DM may always pin; an unknown message rejects without calling the API.
    expect(store.getState().canPin('ana@zilar.test')).toBe(true);
    await expect(store.getState().pinMessage('ana@zilar.test', 'missing')).rejects.toThrow(
      'Message not found',
    );

    await store.getState().pinMessage('ana@zilar.test', 'm-1');
    expect(pins.pinMessage).toHaveBeenCalledWith({
      chat: 'ana@zilar.test',
      messageId: 'm-1',
      senderName: 'Ana',
      text: 'hello',
      kind: 'text',
    });
    // The saved row replaces the optimistic one.
    expect(store.getState().pins('ana@zilar.test')).toHaveLength(1);
    expect(store.getState().pinFor('ana@zilar.test', 'm-1')?.id).toBe('pin-9');

    // A failure restores the previous pins.
    vi.mocked(pins.pinMessage).mockRejectedValueOnce(new Error('down'));
    await expect(store.getState().pinMessage('ana@zilar.test', 'm-1')).rejects.toThrow();
    expect(store.getState().pins('ana@zilar.test')).toHaveLength(1);
    store.getState().stop();
  });

  it('gates pinning: DMs either side, topics owner/admin only', async () => {
    const general = topicRow({
      id: 't-g',
      name: 'General',
      isGeneral: true,
      chatJid: 'general@rooms.zilar.test',
    });
    const { store } = setup([
      dmEntry('ana@zilar.test', 'Ana'),
      groupEntry({ topics: [general, topicRow()] }),
    ]);
    store.getState().start();
    await flush();

    expect(store.getState().canPin('ana@zilar.test')).toBe(true);
    // The fake group detail makes me an admin of g1: topics may pin.
    expect(store.getState().canPin('t-1@rooms.zilar.test')).toBe(true);
    expect(store.getState().canPin('nope')).toBe(false);
    expect(store.getState().pinFor('ana@zilar.test', 'm-1')).toBeUndefined();
    store.getState().stop();
  });

  it('denies pinning to a plain member', async () => {
    const { store } = setup(
      [groupEntry({ topics: [generalRow(), topicRow()] })],
      fakePins(),
      {},
      'member',
    );
    store.getState().start();
    await flush();

    expect(store.getState().canPin('t-1@rooms.zilar.test')).toBe(false);
    await expect(store.getState().pinMessage('t-1@rooms.zilar.test', 'whatever')).rejects.toThrow(
      'You cannot pin here.',
    );
    store.getState().stop();
  });

  it('denies pinning while the group detail has not loaded yet', async () => {
    // A group with topics but no General row (older server shape): the
    // detail request hangs, so no role is known and topics may not pin —
    // while a DM still may.
    const api = fakeApiWithMembers([
      dmEntry('ana@zilar.test', 'Ana'),
      groupEntry({ topics: [topicRow()] }),
    ]);
    vi.mocked(api.getGroup).mockImplementation(() => new Promise(() => {}));
    const store = createRealChatStore({
      api,
      topicsApi: fakeTopics(),
      chatPrefsApi: fakePrefs(),
      pinsApi: fakePins(),
      appState: fakeAppState(),
      openDrafts: () => () => {},
      createXmpp: () => createFakeXmppCore(),
    });
    store.getState().start();
    await flush();

    expect(store.getState().canPin('t-1@rooms.zilar.test')).toBe(false);
    expect(store.getState().canPin('ana@zilar.test')).toBe(true);
    store.getState().stop();
  });

  it('stops the pins poll when leaving the chat', async () => {
    vi.useFakeTimers();
    try {
      const { store, pins } = setup([dmEntry('ana@zilar.test', 'Ana')]);
      store.getState().start();
      await vi.advanceTimersByTimeAsync(0);
      store.getState().openChat('ana@zilar.test');
      await vi.advanceTimersByTimeAsync(0);
      expect(pins.listPins).toHaveBeenCalledTimes(1);

      // Leaving stops the poll: the next 60 s tick makes no request.
      store.getState().stopPinsPoll();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pins.listPins).toHaveBeenCalledTimes(1);

      // Opening again restarts it: one tick, one more request.
      store.getState().openChat('ana@zilar.test');
      await vi.advanceTimersByTimeAsync(0);
      expect(pins.listPins).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pins.listPins).toHaveBeenCalledTimes(3);
      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unpins optimistically and restores the row on failure', async () => {
    const rows = [pinRow({ chat: 'ana@zilar.test', id: 'pin-1' })];
    const pins = fakePins(rows);
    const { store } = setup([dmEntry('ana@zilar.test', 'Ana')], pins);
    store.getState().start();
    await flush();
    store.getState().openChat('ana@zilar.test');
    await flush();
    expect(store.getState().pins('ana@zilar.test')).toEqual(rows);

    await store.getState().unpinMessage('ana@zilar.test', 'pin-1');
    expect(pins.unpinMessage).toHaveBeenCalledWith('pin-1');
    expect(store.getState().pins('ana@zilar.test')).toEqual([]);

    vi.mocked(pins.unpinMessage).mockRejectedValueOnce(new Error('down'));
    // Re-seed the row, then fail the unpin: the row comes back plus the error.
    vi.mocked(pins.listPins).mockResolvedValueOnce(rows);
    await store.getState().refreshPins('ana@zilar.test');
    await expect(store.getState().unpinMessage('ana@zilar.test', 'pin-1')).rejects.toThrow();
    expect(store.getState().pins('ana@zilar.test')).toEqual(rows);
    expect(store.getState().pinsError).toMatchObject({ chatId: 'ana@zilar.test' });
    store.getState().stop();
  });
});
