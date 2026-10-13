// The shared polling loops and draft stream (T-0915).
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { Context, Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreAppHooks } from './ctx';
import { makeLifetime } from './lifetime';
import {
  clearFinishedTurns,
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  DRAFT_STREAM_WATCH_MS,
  markTurnFinished,
  PINS_REFRESH_INTERVAL_MS,
  ROSTER_REFRESH_DEBOUNCE_MS,
  scheduleChatsRefreshBurst,
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
  chats: ChatSummary[];
  messagesByChat: Record<string, UiMessage[]>;
}

const AI_CHAT = {
  id: 'ana',
  title: 'Ana',
  kind: 'dm',
  isAI: true,
  unread: 0,
} as ChatSummary;

const aiMessage = (id: string, text: string): UiMessage => ({
  id,
  chatId: 'ana',
  senderId: 'ana',
  senderName: 'Ana',
  text,
  createdAt: new Date(1),
  status: 'read',
});

function pollingCtx(
  onFocus?: (handler: () => void) => () => void,
  activeChatId?: string,
  seed: Partial<PollState> = {},
) {
  let state: PollState = {
    drafts: {},
    finishedDraftMessages: {},
    activeChatId,
    chats: [AI_CHAT],
    messagesByChat: {},
    ...seed,
  };
  let listener: ((event: DraftHubEvent) => void) | undefined;
  let pendingFocus: (() => void) | undefined;
  let openedCount = 0;
  const close = vi.fn();
  const refreshChats = vi.fn();
  const refreshActiveChatPins = vi.fn();
  const scheduleChatsRefresh = vi.fn();
  const fx = {
    refreshChats,
    refreshActiveChatPins,
    scheduleChatsRefresh,
  } as unknown as StoreAppHooks;
  const rt = makeLifetime(Context.empty());
  const ctx = {
    get: () => state,
    set: (update: (state: PollState) => Partial<PollState> | PollState) => {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
    },
    rt,
    ports: testCorePorts({
      // The fake clock advances with `vi.advanceTimersByTime`, which the
      // coalescing gate reads.
      now: () => new Date(),
      drafts: (onEvent) => {
        openedCount += 1;
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
    scheduleChatsRefresh,
    state: () => state,
    emit: (event: DraftHubEvent) => listener?.(event),
    focus: () => pendingFocus?.(),
    openedCount: () => openedCount,
    // Writes state without going through `ctx.set`, like an app that writes
    // its chats through another view (mobile's history).
    bypassSet: (patch: Partial<PollState>) => {
      state = { ...state, ...patch };
    },
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

  it('drops a draft whose text is already the newest AI message (AI-13)', () => {
    const { ctx, rt, state, emit } = pollingCtx(undefined, undefined, {
      messagesByChat: { ana: [aiMessage('final', 'Hello')] },
    });
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));

    // The final XMPP message arrived before this first SSE frame.
    emit({ type: 'draft', chatJid: 'ana', turnId: 't1', text: 'Hello' });
    expect(state().drafts['ana']).toBeUndefined();

    emit({ type: 'draft', chatJid: 'ana', turnId: 't1', text: 'Hello there' });
    expect(state().drafts['ana']?.text).toBe('Hello there');
  });

  it('does not open the stream when the user has no AI chat (PERF-9)', () => {
    const { ctx, rt, openedCount } = pollingCtx(undefined, undefined, { chats: [] });
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));
    expect(openedCount()).toBe(0);
  });

  it('opens the stream on the watch interval when a write bypasses ctx.set (PERF-9)', () => {
    const { ctx, rt, openedCount, bypassSet } = pollingCtx(undefined, undefined, { chats: [] });
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));
    expect(openedCount()).toBe(0);

    // An app that writes its chats through another view (mobile history) does
    // not go through `ctx.set`; the short watcher still opens the stream.
    bypassSet({ chats: [AI_CHAT] });
    vi.advanceTimersByTime(DRAFT_STREAM_WATCH_MS);
    expect(openedCount()).toBe(1);
  });

  it('opens the stream as soon as chats gain an AI chat, without a tick (PERF-9)', () => {
    const { ctx, rt, openedCount } = pollingCtx(undefined, undefined, { chats: [] });
    const session = rt.beginSession();
    Effect.runSync(startDraftStream(ctx, session));
    expect(openedCount()).toBe(0);

    ctx.set({ chats: [AI_CHAT] });
    expect(openedCount()).toBe(1);

    // A further write with an AI chat still present does not reopen it.
    ctx.set({ chats: [AI_CHAT] });
    expect(openedCount()).toBe(1);
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

  it('refreshes the chat list once per roster push burst (PERF-11)', () => {
    const { ctx, scheduleChatsRefresh } = pollingCtx();

    scheduleChatsRefreshBurst(ctx);
    scheduleChatsRefreshBurst(ctx);
    scheduleChatsRefreshBurst(ctx);
    expect(scheduleChatsRefresh).toHaveBeenCalledTimes(1);

    // The burst window closes: the next push refreshes again.
    vi.advanceTimersByTime(ROSTER_REFRESH_DEBOUNCE_MS);
    scheduleChatsRefreshBurst(ctx);
    expect(scheduleChatsRefresh).toHaveBeenCalledTimes(2);
  });
});
