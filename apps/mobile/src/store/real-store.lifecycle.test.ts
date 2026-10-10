// T-0918 (store core T9): the mobile lifecycle on the core polling and
// lifecycle. These guards pin what must not change (boot, resume, sign-out,
// start idempotency) and then the one new behaviour, the connect retry (R7,
// Q3), before the move onto the core.
import { CONNECT_RETRY_DELAYS_MS } from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';
import { createFakeXmppCore } from '@zilar/xmpp-core/testing';
import { describe, expect, it, vi } from 'vitest';

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
  it('boot loads the chats and the contacts', async () => {
    const { store } = storeWith();

    store.getState().start();
    await waitFor(() => store.getState().chatsLoad === 'loaded');

    expect(store.getState().chats.map((chat) => chat.id)).toEqual([ANA]);
    expect(store.getState().contacts.map((contact) => contact.jid)).toEqual([ANA]);

    store.getState().stop();
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
