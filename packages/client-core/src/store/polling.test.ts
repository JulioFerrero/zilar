// The shared polling loops and draft stream (T-0915).
import { Context, Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreAppHooks } from './ctx';
import { makeLifetime } from './lifetime';
import {
  clearFinishedTurns,
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  markTurnFinished,
  PINS_REFRESH_INTERVAL_MS,
  startChatsPolling,
  startDraftStream,
  startPinsPolling,
  TOPIC_REFRESH_INTERVAL_MS,
  type PollingCtx,
} from './polling';
import { testCorePorts, type DraftHubEvent } from './ports';
import { FINISHED_TURNS_MAX } from './rows';

describe('draft turn bookkeeping', () => {
  const turns = (): { finishedTurns: Set<string>; finishedTurnOrder: string[] } => ({
    finishedTurns: new Set<string>(),
    finishedTurnOrder: [],
  });

  it('remembers at most FINISHED_TURNS_MAX turns, oldest dropped first', () => {
    const ctx = turns();
    for (let index = 0; index < FINISHED_TURNS_MAX + 5; index += 1) {
      markTurnFinished(ctx, `turn-${index}`);
    }
    expect(ctx.finishedTurns.size).toBe(FINISHED_TURNS_MAX);
    expect(ctx.finishedTurns.has('turn-0')).toBe(false);
    expect(ctx.finishedTurns.has(`turn-${FINISHED_TURNS_MAX + 4}`)).toBe(true);
  });

  it('marks a turn once and clears both lists', () => {
    const ctx = turns();
    markTurnFinished(ctx, 'a');
    markTurnFinished(ctx, 'a');
    expect(ctx.finishedTurnOrder).toEqual(['a']);
    clearFinishedTurns(ctx);
    expect(ctx.finishedTurns.size).toBe(0);
    expect(ctx.finishedTurnOrder).toEqual([]);
  });
});

interface PollState {
  drafts: Record<string, { turnId: string; text: string }>;
  finishedDraftMessages: Record<string, string>;
  activeChatId: string | undefined;
}

function pollingCtx(onFocus?: (handler: () => void) => () => void, activeChatId?: string) {
  let state: PollState = { drafts: {}, finishedDraftMessages: {}, activeChatId };
  let listener: ((event: DraftHubEvent) => void) | undefined;
  let pendingFocus: (() => void) | undefined;
  const close = vi.fn();
  const refreshChats = vi.fn();
  const refreshActiveChatPins = vi.fn();
  const fx = { refreshChats, refreshActiveChatPins } as unknown as StoreAppHooks;
  const rt = makeLifetime(Context.empty());
  const ctx = {
    get: () => state,
    set: (update: (state: PollState) => Partial<PollState> | PollState) => {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
    },
    rt,
    ports: testCorePorts({
      drafts: (onEvent) => {
        listener = onEvent;
        return close;
      },
      visibility: {
        isVisible: () => true,
        onFocus: (handler) => {
          pendingFocus = handler;
          return onFocus === undefined ? () => {} : onFocus(handler);
        },
      },
    }),
    fx,
    finishedTurns: new Set<string>(),
    finishedTurnOrder: [] as string[],
  } as unknown as PollingCtx;
  return {
    ctx,
    rt,
    close,
    refreshChats,
    refreshActiveChatPins,
    state: () => state,
    emit: (event: DraftHubEvent) => listener?.(event),
    focus: () => pendingFocus?.(),
  };
}

describe('draft stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a draft and drops it after the idle delay', () => {
    const { ctx, rt, state, emit } = pollingCtx();
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));

    emit({ type: 'draft', chatJid: 'ana', turnId: 't1', text: 'Hi' });
    expect(state().drafts['ana']).toEqual({ turnId: 't1', text: 'Hi' });

    vi.advanceTimersByTime(DRAFT_IDLE_MS - 1);
    expect(state().drafts['ana']).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(state().drafts['ana']).toBeUndefined();
  });

  it('keeps a draft after `end` until the fallback, then drops it', () => {
    const { ctx, rt, state, emit } = pollingCtx();
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));

    emit({ type: 'draft', chatJid: 'ana', turnId: 't1', text: 'Hi' });
    emit({ type: 'end', chatJid: 'ana', turnId: 't1', outcome: 'sent' });
    expect(state().drafts['ana']).toBeDefined();

    vi.advanceTimersByTime(DRAFT_END_FALLBACK_MS);
    expect(state().drafts['ana']).toBeUndefined();
  });

  it('ignores a late draft of a finished turn', () => {
    const { ctx, rt, state, emit } = pollingCtx();
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));

    emit({ type: 'draft', chatJid: 'ana', turnId: 't1', text: 'Hi' });
    emit({ type: 'end', chatJid: 'ana', turnId: 't1', outcome: 'sent' });
    emit({ type: 'draft', chatJid: 'ana', turnId: 't1', text: 'late' });

    expect(state().drafts['ana']?.text).toBe('Hi');
  });
});

describe('polling loops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes the chat list on the interval and on focus', () => {
    const { ctx, rt, refreshChats, focus } = pollingCtx();
    const session = rt.beginSession();
    Effect.runSync(startChatsPolling(ctx, session));

    expect(refreshChats).not.toHaveBeenCalled();
    focus();
    expect(refreshChats).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TOPIC_REFRESH_INTERVAL_MS);
    expect(refreshChats).toHaveBeenCalledTimes(2);
  });

  it('refreshes only the open chat pins', () => {
    const { ctx, rt, refreshActiveChatPins } = pollingCtx(undefined, 'ana');
    const session = rt.beginSession();
    Effect.runSync(startPinsPolling(ctx, session));

    vi.advanceTimersByTime(PINS_REFRESH_INTERVAL_MS);
    expect(refreshActiveChatPins).toHaveBeenCalledWith('ana');
  });
});
