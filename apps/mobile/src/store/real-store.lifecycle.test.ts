// T-0918 (store core T9): the mobile lifecycle on the core polling and
// lifecycle. These guards pin what must not change (boot, resume, sign-out,
// start idempotency) and then the one new behaviour, the connect retry (R7,
// Q3), before the move onto the core.
import { CONNECT_RETRY_DELAYS_MS } from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatListModel } from '../lib/chat-list';
import { parseChatsList } from '../lib/chat-api-schemas';
import { readChatListCache } from './effects/lifecycle';
import type { Pin, PinsApi } from '../lib/pins-api';

// A writable stand-in for the cache file: the read/write go through
// `expo-file-system/legacy` behind a dynamic import, so the real native module
// never loads under Vitest (like the offline cache's port seam).
const cacheFile = vi.hoisted(() => ({ contents: null as string | null }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/documents/',
  readAsStringAsync: async () => cacheFile.contents,
  writeAsStringAsync: async (_uri: string, contents: string) => {
    cacheFile.contents = contents;
  },
  deleteAsync: async () => {
    cacheFile.contents = null;
  },
}));
import type { ChatFoldersApi } from '../lib/chat-folders-api';
import type { ChatPrefsApi } from '../lib/chat-prefs-api';
import { createRealChatStore, type AppStateLike, type RealStoreDeps } from './real-store';
import { fakeApi } from './test-support';
import { flushTasks as flush, waitFor } from '@/test/wait';

const ANA = 'ana@zilar.test';

function anaApi() {
  return fakeApi({
    getChats: vi.fn(async () => [
      { kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' },
    ]),
    getContacts: vi.fn(async () => [{ userId: 'u-ana', name: 'Ana', jid: ANA }]),
  });
}

function connectCalls(core: XmppCore): number {
  // The fake records every method call; `connect` is the one that matters here.
  const fake = core as XmppCore & { calls: { method: string }[] };
  return fake.calls.filter((call) => call.method === 'connect').length;
}

interface FakeAppState extends AppStateLike {
  setActive(): void;
}

function fakeAppState(): FakeAppState {
  let state = 'active';
  const handlers = new Set<(next: string) => void>();
  return {
    current: () => state,
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    setActive() {
      state = 'active';
      for (const handler of handlers) handler(state);
    },
  };
}

function storeWith(deps: Partial<RealStoreDeps> = {}) {
  const api = anaApi();
  const core = createFakeXmppCore();
  const appState = fakeAppState();
  const createXmpp = vi.fn(() => core);
  const store = createRealChatStore({
    api,
    appState,
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp,
    openDrafts: () => () => {},
    ...deps,
  });
  return { store, api, core, appState, createXmpp };
}

describe('mobile store lifecycle (T-0918)', () => {
  beforeEach(() => {
    cacheFile.contents = null;
  });

  it('boot loads the chats and the contacts', async () => {
    const { store } = storeWith();

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');

    expect(store.getState().chats.map((chat) => chat.id)).toEqual([ANA]);
    expect(store.getState().contacts.map((contact) => contact.jid)).toEqual([ANA]);

    store.getState().stop();
  });

  it('a new AI DM with a newer creation time leads the chat list (T-1474)', async () => {
    const AI = 'ai-heron@zilar.test';
    // Decode the raw wire payload through the phone's own schema, the path that
    // only mobile has (web decodes with the contract).
    const entries = parseChatsList({
      chats: [
        // Two rows with neither a message nor a creation time (as in mock):
        // their sort time is `-Infinity`, and the old `right - left` comparator
        // made two of them subtract to `NaN`, which destabilised the whole sort
        // (T-1474).
        { kind: 'dm', chatJid: ANA, title: 'Ana', userId: 'u-ana' },
        {
          kind: 'group',
          chatJid: 'v-1@rooms.zilar.test',
          title: 'Viernes',
          groupId: 'g-viernes',
          memberCount: 5,
          role: 'member',
        },
        { kind: 'dm', chatJid: AI, title: 'Heron', isAi: true, createdAt: '2026-09-28T11:59:00Z' },
      ],
    });
    expect(entries).not.toBeNull();
    const api = fakeApi({ getChats: vi.fn(async () => entries ?? []) });
    const store = createRealChatStore({
      api,
      appState: fakeAppState(),
      now: () => new Date('2026-09-28T12:00:00Z'),
      createXmpp: () => createFakeXmppCore(),
      openDrafts: () => () => {},
    });

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');

    const { rows } = chatListModel(store.getState().chats, { folder: undefined, search: '' });
    expect(rows[0]).toMatchObject({ kind: 'chat', chat: { id: AI } });

    store.getState().stop();
  });

  it('a cold start rehydrates a cached row created time, so a new AI chat leads (T-1474)', async () => {
    const AI = 'ai-finch@zilar.test';
    // JSON keeps a `Date` as an ISO string. The cold start paints this cache and
    // the list sorts it through `chatSortTime`, so the read must bring
    // `createdAt` back to a `Date`; before the fix the string reached `.getTime()`
    // and threw on the first render.
    cacheFile.contents = JSON.stringify({
      version: 1,
      userId: 'u-me',
      chats: [
        {
          id: ANA,
          title: 'Ana',
          kind: 'dm',
          isAI: false,
          space: 'personal',
          unread: 0,
          muted: false,
        },
        {
          id: AI,
          title: 'Finch',
          kind: 'dm',
          isAI: true,
          space: 'personal',
          unread: 0,
          muted: false,
          createdAt: '2026-09-28T11:59:00Z',
        },
      ],
    });

    const cached = await readChatListCache();
    expect(cached).not.toBeNull();
    const ai = cached?.chats.find((chat) => chat.id === AI);
    expect(ai?.createdAt).toBeInstanceOf(Date);
    expect(ai?.createdAt?.getTime()).toBe(Date.parse('2026-09-28T11:59:00Z'));

    const { rows } = chatListModel(cached?.chats ?? [], { folder: undefined, search: '' });
    expect(rows[0]).toMatchObject({ kind: 'chat', chat: { id: AI } });
  });

  it('boot loads the chat folders and the chat prefs', async () => {
    // The move to the core lifecycle dropped mobile's own boot loads of the
    // folders and the pref rows (the old `fx.loadFolders` / `fx.loadPrefRows`),
    // so the folder chips disappeared from the list. The core boot must run
    // them again.
    const chatFoldersApi = {
      listChatFolders: vi.fn(async () => [
        {
          id: 'f-1',
          name: 'Personal',
          icon: 'user',
          position: 0,
          includeTypes: ['dm'],
          includeChats: [],
          excludeChats: [],
          excludeMuted: false,
          excludeRead: false,
        },
      ]),
    } as unknown as ChatFoldersApi;
    const chatPrefsApi = {
      listChatPrefs: vi.fn(async () => [
        {
          chatJid: ANA,
          mutedUntil: null,
          archived: true,
          pinnedAt: null,
          updatedAt: '2026-09-30T11:00:00Z',
        },
      ]),
    } as unknown as ChatPrefsApi;
    const { store } = storeWith({ chatFoldersApi, chatPrefsApi });

    store.getState().start();
    await waitFor(() => store.getState().foldersLoaded && store.getState().chatsLoad === 'loaded');

    expect(store.getState().folders.map((entry) => entry.id)).toEqual(['f-1']);
    expect(chatFoldersApi.listChatFolders).toHaveBeenCalledTimes(1);
    expect(chatPrefsApi.listChatPrefs).toHaveBeenCalledTimes(1);
    expect(store.getState().chats.find((chat) => chat.id === ANA)?.archived).toBe(true);

    store.getState().stop();
  });

  it('a resume reconnects a core that is not online', async () => {
    const { store, core, appState } = storeWith();

    store.getState().start();
    await waitFor(() => store.getState().status === 'online');
    expect(connectCalls(core)).toBe(1);

    core.emit('status', 'offline');
    expect(store.getState().status).toBe('offline');

    appState.setActive();
    await waitFor(() => store.getState().status === 'online');
    expect(connectCalls(core)).toBe(2);

    store.getState().stop();
  });

  it('a resume during an in-flight boot waits instead of booting twice', async () => {
    const gate = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();
    const api = fakeApi({
      getChats: vi.fn(async () => {
        await gate.promise;
        return [{ kind: 'dm' as const, chatJid: ANA, title: 'Ana', userId: 'u-ana' }];
      }),
    });
    const core = createFakeXmppCore();
    const appState = fakeAppState();
    const createXmpp = vi.fn(() => core);
    const store = createRealChatStore({
      api,
      appState,
      now: () => new Date('2026-09-28T12:00:00Z'),
      createXmpp,
      openDrafts: () => () => {},
    });

    store.getState().start();
    await flush();
    expect(api.getChats).toHaveBeenCalledTimes(1);

    appState.setActive();
    await flush();
    // Still one boot in flight: no second core while it runs.
    expect(createXmpp).toHaveBeenCalledTimes(0);

    gate.resolve();
    await waitFor(() => store.getState().status === 'online');
    expect(createXmpp).toHaveBeenCalledTimes(1);

    store.getState().stop();
  });

  it('start() twice without stop() boots once', async () => {
    const { store, api, createXmpp } = storeWith();

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');
    store.getState().start();
    await flush();

    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.getChats).toHaveBeenCalledTimes(1);
    expect(createXmpp).toHaveBeenCalledTimes(1);

    store.getState().stop();
  });

  it('stop() (sign-out) clears the user scoped state', async () => {
    const { store } = storeWith();

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');
    expect(store.getState().chats.length).toBeGreaterThan(0);

    store.getState().stop();

    expect(store.getState().chats).toEqual([]);
    expect(store.getState().contacts).toEqual([]);
    expect(store.getState().me).toBeUndefined();
    expect(store.getState().status).toBe('offline');
  });

  it('stop() (sign-out) clears the pins of the previous user (T-1916)', async () => {
    const { store } = storeWith();

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');

    // A DM's chat id is the peer's JID, so without a teardown the next user's
    // DM with the same peer would find the previous user's pins in the map.
    store.getState().seedCachedPins({
      [ANA]: [
        {
          id: 'p-1',
          chat: ANA,
          messageId: 'm-1',
          senderName: 'Ana',
          text: 'hola',
          kind: 'text',
          pinnedBy: 'u-ana',
          pinnedAt: '2026-09-28T11:59:00Z',
        },
      ],
    });
    expect(store.getState().pins(ANA)).toHaveLength(1);

    store.getState().stop();

    expect(store.getState().pins(ANA)).toEqual([]);
  });

  it('a pins load that lands after stop() does not republish them (T-1916)', async () => {
    // refreshPins runs detached from the session scope, so `stop()` cannot
    // cancel it. Its answer must not put the previous user's pins back after
    // the teardown cleared them.
    let resolvePins!: (pins: Pin[]) => void;
    const pinsApi = {
      listPins: vi.fn(
        () =>
          new Promise<Pin[]>((resolve) => {
            resolvePins = resolve;
          }),
      ),
    } as unknown as PinsApi;
    const { store } = storeWith({ pinsApi });

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');

    store.getState().refreshPins(ANA);
    await flush();
    expect(pinsApi.listPins).toHaveBeenCalledTimes(1);

    store.getState().stop();
    resolvePins([
      {
        id: 'p-late',
        chat: ANA,
        messageId: 'm-late',
        senderName: 'Ana',
        text: 'hola',
        kind: 'text',
        pinnedBy: 'u-ana',
        pinnedAt: '2026-09-28T11:59:00Z',
      },
    ]);
    await flush();

    expect(store.getState().pins(ANA)).toEqual([]);
  });

  it('retries the connection on the delay ladder when connect() rejects', async () => {
    // A refused socket used to leave mobile offline until the next resume
    // (R7, Q3); after the move it retries after 2 s, then 5 s, and so on.
    vi.useFakeTimers();
    try {
      const { store, core } = storeWith();
      const connect = vi
        .spyOn(core, 'connect')
        .mockRejectedValueOnce(new Error('socket refused'))
        .mockRejectedValueOnce(new Error('socket refused'));

      store.getState().start();
      await flush();
      expect(store.getState().status).toBe('offline');
      expect(connect).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_DELAYS_MS[0] ?? 0);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(store.getState().status).toBe('offline');

      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_DELAYS_MS[1] ?? 0);
      expect(connect).toHaveBeenCalledTimes(3);
      expect(store.getState().status).toBe('online');

      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a resume after a failed connect boots a fresh core, not the deaf stale one', async () => {
    // PREREVIEW finding 1: a failed connect closes its attempt (the listeners
    // come off) and leaves only the retry sleep pending. A resume must not call
    // connect() on that stale, listener-less core: it would report online while
    // dropping every incoming event. It boots a fresh core instead.
    vi.useFakeTimers();
    try {
      const first = createFakeXmppCore();
      first.failures.connect = new Error('socket refused');
      const second = createFakeXmppCore();
      const createXmpp = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
      const api = anaApi();
      const appState = fakeAppState();
      const store = createRealChatStore({
        api,
        appState,
        now: () => new Date('2026-09-28T12:00:00Z'),
        createXmpp,
        openDrafts: () => () => {},
      });

      store.getState().start();
      await flush();
      expect(store.getState().status).toBe('offline');
      expect(createXmpp).toHaveBeenCalledTimes(1);
      expect(connectCalls(first)).toBe(1);

      appState.setActive();
      await flush(20);

      // A fresh core connected once; the stale one is left alone.
      expect(createXmpp).toHaveBeenCalledTimes(2);
      expect(connectCalls(first)).toBe(1);
      expect(connectCalls(second)).toBe(1);
      expect(store.getState().status).toBe('online');

      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
