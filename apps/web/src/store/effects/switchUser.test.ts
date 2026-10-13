import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { StoreCtx } from './ctx';
import { resetUserState } from './lifecycle';
import { PortsTest } from './ports';

/**
 * A context with only what `resetUserState` touches: the state accessors, the
 * ledger bookkeeping and the per-user maps. The effect modules see the full
 * `StoreCtx`, but a reset reads a small, stable set of fields.
 */
function fakeCtx(): { ctx: StoreCtx; state: () => Record<string, unknown> } {
  let state: Record<string, unknown> = {
    currentUserId: 'u-b',
    me: { id: 'u-b', email: 'b@zilar.test', name: 'B' },
    status: 'online',
    chatsState: 'ready',
    chats: [{ id: 'ana@zilar.test' }],
    contacts: [{ userId: 'u-ana' }],
    historyState: { 'ana@zilar.test': 'ready' },
    messagesByChat: { 'ana@zilar.test': [{ id: 'm1' }] },
    activeChatId: 'ana@zilar.test',
    folders: [{ id: 'work' }],
    activeFolder: 'work',
    stop: () => undefined,
  };
  const messageAuthors = new Map([['m1', { name: 'Ana' }]]);
  const messageOriginIds = new Map([['m1', 'origin-1']]);
  const messageBaseTexts = new Map([['m1', 'hello']]);
  const ctx = {
    get: () => state,
    set: (patch: Record<string, unknown>) => {
      state = { ...state, ...patch };
    },
    pendingOutgoing: new Map([['m1', ['x']]]),
    cursors: { 'ana@zilar.test': 'cursor-1' },
    lastRead: { 'ana@zilar.test': 'm1' },
    finishedTurns: new Set(['turn-1']),
    finishedTurnOrder: ['turn-1'],
    groupMembers: new Map([['ana@zilar.test', new Map()]]),
    groupInfos: new Map([['ana@zilar.test', {}]]),
    messageAuthors,
    messageOriginIds,
    messageBaseTexts,
    // The ledger's own reset clears every id side table it knows (UI-13).
    k: {
      reset: () => {
        messageAuthors.clear();
        messageOriginIds.clear();
        messageBaseTexts.clear();
      },
    },
    cachedUserId: 'u-b',
    lastReadUserId: 'u-b',
  } as unknown as StoreCtx;
  return { ctx, state: () => state };
}

describe('resetUserState (T-1136)', () => {
  it('clears the user state and the per-message caches', async () => {
    const { ctx, state } = fakeCtx();

    await Effect.runPromise(resetUserState(ctx).pipe(Effect.provide(PortsTest())));

    const current = state();
    expect(current.chats).toEqual([]);
    expect(current.chatsState).toBe('loading');
    expect(current.me).toBeUndefined();
    expect(current.currentUserId).toBe('');
    expect(current.status).toBe('offline');
    expect(current.activeChatId).toBeUndefined();

    // The per-message caches are user scoped: an author, an origin id and a
    // base text from the previous account must not survive into the next one.
    expect(ctx.messageAuthors.size).toBe(0);
    expect(ctx.messageOriginIds.size).toBe(0);
    expect(ctx.messageBaseTexts.size).toBe(0);
    expect(ctx.cachedUserId).toBeUndefined();
  });
});
