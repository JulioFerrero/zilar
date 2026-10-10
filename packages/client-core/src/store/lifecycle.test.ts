// The shared lifecycle: read-last-read, stop vs reset, start idempotency and
// the resume gate (T-0915).
import { Context, Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { StoreAppHooks } from './ctx';
import { makeLifetime } from './lifetime';
import {
  readLastRead,
  reconnect,
  reset,
  startStore,
  stopStore,
  type LifecycleCtx,
} from './lifecycle';
import { testCorePorts, type CorePorts, type KeyValue } from './ports';

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
});
