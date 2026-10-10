// T-0915 (store core T8): the lifecycle behaviours the core takes over —
// start idempotency, connect retries and sign-out. These run on web's facade
// and pin the behaviour before the move, like the T6 and T6b stores did.
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@zilar/xmpp-core';
import { fakeApi, fakeXmpp } from '@/test/storeHarness';
import { flushTasks as flush, waitFor as pollUntil } from '@/test/wait';
import { CONNECT_RETRY_DELAYS_MS, createRealChatStore, type StorageLike } from './realStore';

// Sign-out must not hit Better Auth over the network in a test.
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

function seedMessage(): ChatMessage {
  return {
    id: 'ana-1',
    kind: 'chat',
    chatJid: 'ana@zilar.test',
    fromJid: 'ana@zilar.test',
    fromResolved: true,
    timestamp: new Date('2026-09-28T10:00:00Z'),
    outgoing: false,
    body: 'hello',
  };
}

// One of my own messages, taught to the ledger with (or without) the
// sender-generated origin id a later edit must name (XEP-0308).
function myMessage(originId?: string): ChatMessage {
  return {
    ...seedMessage(),
    fromJid: 'me@zilar.test',
    outgoing: true,
    ...(originId === undefined ? {} : { originId }),
  };
}

function storeWith(
  overrides: Parameters<typeof fakeApi>[0] = {},
  deps: Parameters<typeof createRealChatStore>[0] = {},
) {
  const api = fakeApi(overrides);
  const xmpp = fakeXmpp();
  xmpp.history['ana@zilar.test'] = [seedMessage()];
  const store = createRealChatStore({
    api,
    storage: memoryStorage(),
    now: () => new Date('2026-09-28T12:00:00Z'),
    createXmpp: () => xmpp.core,
    ...deps,
  });
  return { store, api, xmpp };
}

describe('store lifecycle (T-0915)', () => {
  it('retries the connection on the delay ladder when connect() rejects', async () => {
    // The reject branch after `connect()` had no test: a refused socket used
    // to be covered only through a failed token request.
    vi.useFakeTimers();
    try {
      const { store, xmpp } = storeWith();
      vi.mocked(xmpp.core.connect)
        .mockRejectedValueOnce(new Error('socket refused'))
        .mockResolvedValue(undefined);

      store.getState().start();
      await flush();
      expect(store.getState().status).toBe('offline');
      expect(xmpp.core.connect).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_DELAYS_MS[0] ?? 0);
      expect(xmpp.core.connect).toHaveBeenCalledTimes(2);
      expect(store.getState().status).toBe('online');

      store.getState().stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('start() without stop() boots once', async () => {
    const { store, api } = storeWith();

    store.getState().start();
    await flush();
    store.getState().start();
    await flush();

    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(api.getChats).toHaveBeenCalledTimes(1);

    store.getState().stop();
  });

  it('sign-out clears the store and reloads the login page', async () => {
    const goToLogin = vi.fn();
    const { store, xmpp } = storeWith({}, { goToLogin });
    // My own message with an origin id: the ledger learns the edit wire
    // target (and the author and base text) for its id, the per-message caches.
    xmpp.history['ana@zilar.test'] = [myMessage('origin-a')];

    store.getState().start();
    await pollUntil(() => store.getState().chatsState === 'ready');
    store.getState().openChat('ana@zilar.test');
    await pollUntil(() => store.getState().messages('ana@zilar.test').length > 0);
    store.getState().editMessage('ana@zilar.test', 'ana-1', 'first edit');
    await flush();
    expect(xmpp.core.sendCorrection).toHaveBeenLastCalledWith(
      'ana@zilar.test',
      'chat',
      'origin-a',
      'first edit',
      undefined,
    );

    await store.getState().signOut();

    expect(goToLogin).toHaveBeenCalledTimes(1);
    expect(store.getState().chats).toEqual([]);
    expect(store.getState().messagesByChat).toEqual({});
    expect(store.getState().edits).toEqual({});
    expect(store.getState().reactions).toEqual({});
    expect(store.getState().currentUserId).toBe('');
    expect(store.getState().status).toBe('offline');

    // The next session on the same store sees the same message id without an
    // origin id. If the per-message caches had survived sign-out, the stale
    // origin id would still name a wire target and the edit would go out;
    // cleared, `correctionTargetFor` is undefined and nothing is sent.
    xmpp.history['ana@zilar.test'] = [myMessage()];
    store.getState().start();
    await pollUntil(() => store.getState().chatsState === 'ready');
    store.getState().openChat('ana@zilar.test');
    await pollUntil(() => store.getState().messages('ana@zilar.test').length > 0);

    vi.mocked(xmpp.core.sendCorrection).mockClear();
    store.getState().editMessage('ana@zilar.test', 'ana-1', 'second edit');
    await flush();
    expect(xmpp.core.sendCorrection).not.toHaveBeenCalled();
  });
});
