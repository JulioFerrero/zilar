// The shared lifecycle: read-last-read, stop vs reset, start idempotency and
// the resume gate (T-0915).
import { Context, Effect, Fiber } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { XmppCore } from '@zilar/xmpp-core';
import type { StoreAppHooks } from './ctx';
import type { SessionCheck } from './session-check';
import { makeLifetime } from './lifetime';
import {
  readLastRead,
  reconnect,
  reset,
  startStore,
  stopStore,
  type LifecycleCtx,
} from './lifecycle';
import type { CorePorts, KeyValue } from './ports';
import { testCorePorts } from './test-support';

function memoryStorage(data: Record<string, string> = {}): KeyValue {
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function hooks(): StoreAppHooks {
  return {
    syncBadge: vi.fn(),
    dismissChatNotifications: vi.fn(),
    loadGroupMembers: vi.fn(),
    finishDraftTurn: vi.fn(),
    forgetRetryBytes: vi.fn(),
    setStatus: vi.fn(),
    prepareStart: vi.fn(),
    setChatsLoad: vi.fn(),
    applyBoot: vi.fn(),
    rememberGroupIds: vi.fn(),
    scheduleChatsRefresh: vi.fn(),
    refreshChats: vi.fn(),
    refreshActiveChatPins: vi.fn(),
    joinGroups: vi.fn(async () => undefined),
    saveChatList: vi.fn(),
    refreshDefaultBackground: vi.fn(),
    setMediaTrustedHosts: vi.fn(),
    applyStop: vi.fn(),
  };
}

interface LifecycleState {
  chats: unknown[];
  messagesByChat: Record<string, unknown[]>;
  edits: Record<string, unknown>;
  reactions: Record<string, unknown>;
  typing: Record<string, unknown>;
  drafts: Record<string, unknown>;
  finishedDraftMessages: Record<string, string>;
  historyComplete: Record<string, boolean>;
  status: string;
  activeChatId: string | undefined;
  me?: { id: string };
}

function lifecycleCtx(
  options: { ports?: Partial<CorePorts>; state?: Partial<LifecycleState> } = {},
) {
  let state: LifecycleState = {
    chats: [],
    messagesByChat: { ana: [{}] },
    edits: {},
    reactions: {},
    typing: {},
    drafts: {},
    finishedDraftMessages: {},
    historyComplete: {},
    status: 'offline',
    activeChatId: undefined,
    ...options.state,
  };
  const rt = makeLifetime(Context.empty());
  const fx = hooks();
  const ctx = {
    get: () => state,
    set: (update: (state: LifecycleState) => Partial<LifecycleState> | LifecycleState) => {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
    },
    rt,
    ports: testCorePorts(options.ports),
    fx,
    k: {},
    core: undefined,
    lastRead: {},
    lastReadUserId: undefined,
    pendingOutgoing: new Map(),
    finishedTurns: new Set<string>(),
    finishedTurnOrder: [] as string[],
    started: false,
    cachedUserId: undefined,
    connectRetryAttempt: 0,
    connectRetryPending: false,
    mediaToken: undefined,
    boot: undefined,
    groupsJoined: false,
    pendingOpenChatId: undefined,
    cursors: {},
    loadingHistory: new Set<string>(),
    loadingOlder: new Set<string>(),
  } as unknown as LifecycleCtx;
  return { ctx, rt, fx, state: () => state };
}

describe('readLastRead', () => {
  it('reads the saved map, and nothing usable reads as none', () => {
    const storage = memoryStorage({ 'zilar:lastRead:u-me': JSON.stringify({ ana: 'm-1' }) });
    expect(Effect.runSync(readLastRead(storage, 'u-me'))).toEqual({ ana: 'm-1' });

    const bad = memoryStorage({ 'zilar:lastRead:u-me': 'not json' });
    expect(Effect.runSync(readLastRead(bad, 'u-me'))).toEqual({});

    expect(Effect.runSync(readLastRead(null, 'u-me'))).toEqual({});
  });
});

describe('stop and reset (R10)', () => {
  it('stop keeps the message ledger, reset clears it', () => {
    const { ctx } = lifecycleCtx();

    Effect.runSync(stopStore(ctx));
    expect(ctx.get().messagesByChat).toEqual({ ana: [{}] });

    reset(ctx);
    expect(ctx.get().messagesByChat).toEqual({});
    expect(ctx.get().edits).toEqual({});
    expect(ctx.get().reactions).toEqual({});
  });

  it('reset also clears the finished-turn memory', () => {
    const { ctx } = lifecycleCtx();
    ctx.finishedTurns.add('t-1');
    ctx.finishedTurnOrder.push('t-1');

    reset(ctx);

    expect(ctx.finishedTurns.size).toBe(0);
    expect(ctx.finishedTurnOrder).toEqual([]);
  });
});

describe('boot bookkeeping', () => {
  it('clears the in-flight boot once it settles, so a resume can reconnect', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { ctx } = lifecycleCtx({
      ports: {
        api: {
          getMe: async () => {
            await gate;
            return { id: 'u-me', name: 'Me' };
          },
          getChats: async () => [],
          getContacts: async () => [],
          getXmppToken: async () => ({ jid: 'me@x', token: 't', service: 's', domain: 'd' }),
        },
      },
    });

    Effect.runSync(startStore(ctx));
    const boot = ctx.boot;
    expect(boot).toBeDefined();
    const fiber = boot?.fiber;
    expect(fiber).toBeDefined();

    release();
    await Effect.runPromise(Fiber.await(fiber!));
    // The boot settled: a resume must see no in-flight boot and reconnect.
    expect(ctx.boot).toBeUndefined();
  });

  it('fetches the XMPP token beside the boot fetches, once (T-1944)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getXmppToken = vi.fn(async () => ({
      jid: 'me@x',
      token: 't',
      service: 's',
      domain: 'd',
    }));
    const { ctx } = lifecycleCtx({
      ports: {
        api: {
          getMe: async () => {
            await gate;
            return { id: 'u-me', name: 'Me' };
          },
          getChats: async () => [],
          getContacts: async () => [],
          getXmppToken,
        },
      },
    });

    Effect.runSync(startStore(ctx));
    // `getMe` is still gated, so the token was not waiting for the boot fetches.
    expect(getXmppToken).toHaveBeenCalledTimes(1);

    release();
    await Effect.runPromise(Fiber.await(ctx.boot!.fiber!));

    // The connection reused the prefetched token instead of asking again.
    expect(getXmppToken).toHaveBeenCalledTimes(1);
    expect(ctx.mediaToken).toEqual({ service: 's', domain: 'd' });
  });
});

describe('start idempotency (R9)', () => {
  it('a second start without stop keeps the same session', () => {
    const { ctx, rt } = lifecycleCtx();

    Effect.runSync(startStore(ctx));
    const first = rt.session();
    expect(first).toBeDefined();
    expect(ctx.fx.prepareStart).toHaveBeenCalledTimes(1);

    Effect.runSync(startStore(ctx));
    expect(rt.session()).toBe(first);
    expect(ctx.fx.prepareStart).toHaveBeenCalledTimes(1);

    Effect.runSync(stopStore(ctx));
    expect(ctx.started).toBe(false);
  });
});

describe('resume gate (R8)', () => {
  it('does nothing while reconnectOnResume is off', () => {
    const { ctx, rt } = lifecycleCtx({
      ports: { flags: { connectRetry: true, reconnectOnResume: false } },
    });
    ctx.started = true;

    Effect.runSync(reconnect(ctx));
    expect(rt.session()).toBeUndefined();
  });

  it('does nothing before start', () => {
    const { ctx, rt } = lifecycleCtx({
      ports: { flags: { connectRetry: true, reconnectOnResume: true } },
    });

    Effect.runSync(reconnect(ctx));
    expect(rt.session()).toBeUndefined();
  });

  it('boots when started with no core', () => {
    const { ctx, rt } = lifecycleCtx({
      ports: { flags: { connectRetry: true, reconnectOnResume: true } },
    });
    ctx.started = true;

    Effect.runSync(reconnect(ctx));
    expect(rt.session()).toBeDefined();
  });

  it('wakes a stale-online core instead of trusting its status (F1)', async () => {
    let wakes = 0;
    let connects = 0;
    const { ctx, fx } = lifecycleCtx({
      ports: { flags: { connectRetry: true, reconnectOnResume: true } },
      state: { status: 'online' },
    });
    ctx.started = true;
    // The test ctx carries no `me`: the resume path skips the group joins.
    ctx.core = {
      connect: async () => {
        connects += 1;
      },
      wake: async () => {
        wakes += 1;
        return 'resumed';
      },
    } as unknown as XmppCore;

    await Effect.runPromise(reconnect(ctx));

    // The stale `online` status no longer short-circuits the resume: the
    // core wakes instead of connecting.
    expect(wakes).toBe(1);
    expect(connects).toBe(0);
    expect(fx.setStatus).toHaveBeenCalledWith('online');
  });

  it('skips the group rejoin when the stream resumed (R8)', async () => {
    const { ctx, fx } = lifecycleCtx({
      ports: { flags: { connectRetry: true, reconnectOnResume: true } },
      state: { status: 'online', me: { id: 'u-me' } },
    });
    ctx.started = true;
    ctx.core = {
      wake: async () => 'resumed',
    } as unknown as XmppCore;

    await Effect.runPromise(reconnect(ctx));

    // The resumed stream kept the room occupancy: no round trip per room.
    expect(fx.joinGroups).not.toHaveBeenCalled();
    expect(ctx.groupsJoined).toBe(true);
  });

  it('rejoins the group rooms when the session rebound (R8)', async () => {
    const { ctx, fx } = lifecycleCtx({
      ports: { flags: { connectRetry: true, reconnectOnResume: true } },
      state: { status: 'online', me: { id: 'u-me' } },
    });
    ctx.started = true;
    const core = {
      wake: async () => 'rebound',
    } as unknown as XmppCore;
    ctx.core = core;

    await Effect.runPromise(reconnect(ctx));

    // A fresh session lost the rooms: they are joined once, as before.
    expect(fx.joinGroups).toHaveBeenCalledTimes(1);
    expect(fx.joinGroups).toHaveBeenCalledWith(core, { id: 'u-me' }, expect.anything());
  });

  it('the core emitting authFailed schedules the connect retry', async () => {
    // T-1197 (T-1193 follow-up F1): the `authFailed` listener schedules the
    // connect retry ladder behind `flags.connectRetry`. Booting with a token
    // fetch that fails for good emits `authFailed` from the fake core, and
    // the store marks the retry pending instead of staying offline.
    const { ctx } = lifecycleCtx({
      ports: {
        flags: { connectRetry: true, reconnectOnResume: true },
        api: {
          getMe: async () => ({ id: 'u-me', name: 'Me' }),
          getChats: async () => [],
          getContacts: async () => [],
          getXmppToken: async () => ({ jid: 'me@x', token: 't', service: 's', domain: 'd' }),
        },
        createXmpp: () => {
          const listeners = new Map<string, (payload: never) => void>();
          return {
            on: (event: string, cb: (payload: never) => void) => {
              listeners.set(event, cb);
              return () => {
                listeners.delete(event);
              };
            },
            connect: async () => undefined,
            disconnect: async () => undefined,
            emitAuthFailed: () => {
              listeners.get('authFailed')?.(undefined as never);
            },
          } as unknown as XmppCore & { emitAuthFailed: () => void };
        },
      },
    });

    Effect.runSync(startStore(ctx));
    await Effect.runPromise(
      Effect.sleep(10).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const current = ctx.core as unknown as { emitAuthFailed?: () => void } | undefined;
            current?.emitAuthFailed?.();
          }),
        ),
        Effect.andThen(Effect.sleep(10)),
      ),
    );

    expect(ctx.connectRetryPending).toBe(true);
  });

  it("authFailed with checkSession 'gone' signs out without a retry", async () => {
    // T-1223: a session revoked on the server answers 401 on `GET /api/me`,
    // so the store signs out (the app's login) instead of retrying for ever.
    const sessionGone = vi.fn();
    const { ctx } = lifecycleCtx({
      ports: {
        flags: { connectRetry: true, reconnectOnResume: true },
        api: {
          getMe: async () => ({ id: 'u-me', name: 'Me' }),
          getChats: async () => [],
          getContacts: async () => [],
          getXmppToken: async () => ({ jid: 'me@x', token: 't', service: 's', domain: 'd' }),
        },
        checkSession: async () => 'gone',
        sessionGone,
        createXmpp: () => {
          const listeners = new Map<string, (payload: never) => void>();
          return {
            on: (event: string, cb: (payload: never) => void) => {
              listeners.set(event, cb);
              return () => {
                listeners.delete(event);
              };
            },
            connect: async () => undefined,
            disconnect: async () => undefined,
            emitAuthFailed: () => {
              listeners.get('authFailed')?.(undefined as never);
            },
          } as unknown as XmppCore & { emitAuthFailed: () => void };
        },
      },
    });

    Effect.runSync(startStore(ctx));
    await Effect.runPromise(
      Effect.sleep(10).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const current = ctx.core as unknown as { emitAuthFailed?: () => void } | undefined;
            current?.emitAuthFailed?.();
          }),
        ),
        Effect.andThen(Effect.sleep(10)),
      ),
    );

    expect(sessionGone).toHaveBeenCalledTimes(1);
    expect(ctx.connectRetryPending).toBe(false);
  });

  it("authFailed with checkSession 'unknown' keeps the ladder retry", async () => {
    // T-1223: anything but a 401 (another status, a network error, a
    // rejection) must not sign anyone out; the retry ladder runs instead.
    const sessionGone = vi.fn();
    const { ctx } = lifecycleCtx({
      ports: {
        flags: { connectRetry: true, reconnectOnResume: true },
        api: {
          getMe: async () => ({ id: 'u-me', name: 'Me' }),
          getChats: async () => [],
          getContacts: async () => [],
          getXmppToken: async () => ({ jid: 'me@x', token: 't', service: 's', domain: 'd' }),
        },
        checkSession: async () => 'unknown' as const,
        sessionGone,
        createXmpp: () => {
          const listeners = new Map<string, (payload: never) => void>();
          return {
            on: (event: string, cb: (payload: never) => void) => {
              listeners.set(event, cb);
              return () => {
                listeners.delete(event);
              };
            },
            connect: async () => undefined,
            disconnect: async () => undefined,
            emitAuthFailed: () => {
              listeners.get('authFailed')?.(undefined as never);
            },
          } as unknown as XmppCore & { emitAuthFailed: () => void };
        },
      },
    });

    Effect.runSync(startStore(ctx));
    await Effect.runPromise(
      Effect.sleep(10).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const current = ctx.core as unknown as { emitAuthFailed?: () => void } | undefined;
            current?.emitAuthFailed?.();
          }),
        ),
        Effect.andThen(Effect.sleep(10)),
      ),
    );

    expect(sessionGone).not.toHaveBeenCalled();
    expect(ctx.connectRetryPending).toBe(true);
  });

  it('a stale check completion never signs out the new session', async () => {
    // T-1223 finding 1: `stop()` + `start()` (or a sign-in as another user)
    // while the check is in flight orphans it. The old check resolving
    // `'gone'` must not clear the new session's token.
    const sessionGone = vi.fn();
    const { ctx } = lifecycleCtx({
      ports: {
        flags: { connectRetry: true, reconnectOnResume: true },
        api: {
          getMe: async () => ({ id: 'u-me', name: 'Me' }),
          getChats: async () => [],
          getContacts: async () => [],
          getXmppToken: async () => ({ jid: 'me@x', token: 't', service: 's', domain: 'd' }),
        },
        checkSession: () =>
          new Promise<SessionCheck>((resolve) => setTimeout(() => resolve('gone'), 20)),
        sessionGone,
        createXmpp: () => {
          const listeners = new Map<string, (payload: never) => void>();
          return {
            on: (event: string, cb: (payload: never) => void) => {
              listeners.set(event, cb);
              return () => {
                listeners.delete(event);
              };
            },
            connect: async () => undefined,
            disconnect: async () => undefined,
            emitAuthFailed: () => {
              listeners.get('authFailed')?.(undefined as never);
            },
          } as unknown as XmppCore & { emitAuthFailed: () => void };
        },
      },
    });

    Effect.runSync(startStore(ctx));
    await Effect.runPromise(
      Effect.sleep(10).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const current = ctx.core as unknown as { emitAuthFailed?: () => void } | undefined;
            current?.emitAuthFailed?.();
          }),
        ),
      ),
    );
    // A manual sign-out and a fresh start before the old check resolves.
    Effect.runSync(stopStore(ctx));
    Effect.runSync(startStore(ctx));
    expect(ctx.connectRetryPending).toBe(false);

    await Effect.runPromise(Effect.sleep(40));

    expect(sessionGone).not.toHaveBeenCalled();
    expect(ctx.connectRetryPending).toBe(false);
  });
});
