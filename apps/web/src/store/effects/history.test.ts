import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreCtx } from './ctx';
import { canLoadHistory, openAtMessage } from './history';

const dm = { id: 'ana@zilar.test', kind: 'dm' } as ChatSummary;
const group = { id: 'team@rooms.zilar.test', kind: 'group' } as ChatSummary;

function ctxWith(overrides: Partial<StoreCtx>): StoreCtx {
  return overrides as StoreCtx;
}

describe('canLoadHistory', () => {
  const core = {} as NonNullable<StoreCtx['core']>;

  it('needs a core and an online status', () => {
    const online = (): { status: string } => ({ status: 'online' });
    expect(
      canLoadHistory(ctxWith({ core: undefined, get: online as never, groupsJoined: true }), dm),
    ).toBe(false);
    expect(
      canLoadHistory(
        ctxWith({ core, get: (() => ({ status: 'offline' })) as never, groupsJoined: true }),
        dm,
      ),
    ).toBe(false);
    expect(canLoadHistory(ctxWith({ core, get: online as never, groupsJoined: false }), dm)).toBe(
      true,
    );
  });

  it('a group also waits until its rooms are joined', () => {
    const get = (() => ({ status: 'online' })) as never;
    expect(canLoadHistory(ctxWith({ core: {} as never, get, groupsJoined: false }), group)).toBe(
      false,
    );
    expect(canLoadHistory(ctxWith({ core: {} as never, get, groupsJoined: true }), group)).toBe(
      true,
    );
  });
});

describe('openAtMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up with message_not_found after the stalled wait', async () => {
    const openChat = vi.fn();
    const state = {
      openChat,
      chats: [group],
      status: 'online',
      historyComplete: {},
    };
    const ctx = ctxWith({
      get: (() => state) as never,
      core: {} as never,
      groupsJoined: true,
      cursors: {},
      // A first-page load that never settles.
      loadingHistory: new Set([group.id]),
      k: { listFor: () => [], sameMessage: () => false } as never,
    });
    const outcome = Effect.runPromise(Effect.flip(openAtMessage(ctx, group.id, 'missing')));
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await outcome;
    expect(error.message).toBe('message_not_found');
    expect(openChat).toHaveBeenCalledWith(group.id);
  });
});
