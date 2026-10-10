// Background loops of the store, shared by both apps: the 60 s chat list poll
// and the open chat's pins poll (both also run on focus), and the AI draft
// stream with the timers that drop a finished or stale draft. Loops are forked
// into a Scope, so they stop when it closes. The app supplies the two refreshes
// and the draft stream through its hooks and ports.
import { Effect, Schedule, type Scope } from 'effect';
import type { CoreCtx, StoreAppHooks } from './ctx';
import type { HistoryCtx } from './history';
import type { Fibers } from './lifetime';
import type { DraftHubEvent } from './ports';
import { recordRead } from './reads';
import { coreKind, FINISHED_TURNS_MAX, withoutDraft } from './rows';

// Refetch `/api/chats` every 60 s while the tab is visible, and on focus.
export const TOPIC_REFRESH_INTERVAL_MS = 60_000;
// T-0114: the open chat's pins refresh on the same cadence (no realtime channel).
export const PINS_REFRESH_INTERVAL_MS = 60_000;

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

const DRAFT_STREAM_KEY = 'draft-stream';

const draftTimerKey = (chatId: string): string => `draft:${chatId}`;

/** The draft-turn bookkeeping a polling context needs beside the history state. */
export interface DraftTurns {
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
}

export interface PollingCtx extends HistoryCtx, DraftTurns {
  readonly fx: StoreAppHooks;
}

// One tick every `intervalMs`, the first one after the first wait (like a
// `setInterval`). A defect in a tick is logged and the loop goes on.
const everyInterval = (intervalMs: number, tick: Effect.Effect<void>): Effect.Effect<void> =>
  tick.pipe(
    Effect.catchDefect((defect) => Effect.logError('chat store poll failed', defect)),
    Effect.repeat(Schedule.spaced(intervalMs)),
    Effect.delay(intervalMs),
    Effect.asVoid,
  );

// Runs `onFocus` on every focus while the surrounding Scope is open.
const whileFocused = (
  ctx: PollingCtx,
  onFocus: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => ctx.ports.visibility.onFocus(onFocus)),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

// Coming back to a chat that collected messages while the app was hidden
// clears its unread at once: the same `recordRead` + read marker pair that
// opening the chat uses, instead of leaving the badge until the user leaves
// and reopens it (T-0950).
export function clearActiveChatRead(ctx: CoreCtx): void {
  const state = ctx.get();
  const chatId = state.activeChatId;
  if (chatId === undefined || chatId === null) {
    return;
  }
  const chat = state.chats.find((entry) => entry.id === chatId);
  if (chat === undefined || chat.unread === 0) {
    return;
  }
  const newest = chat.lastMessage?.id;
  recordRead(ctx, chatId, newest);
  if (newest !== undefined && ctx.core !== undefined) {
    ctx.core.markDisplayed(chatId, coreKind(chat), newest);
  }
}

const chatsPolling = (ctx: PollingCtx): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* whileFocused(ctx, () => {
        ctx.fx.refreshChats();
        clearActiveChatRead(ctx);
      });
      yield* everyInterval(
        TOPIC_REFRESH_INTERVAL_MS,
        Effect.sync(() => {
          if (ctx.ports.visibility.isVisible()) {
            ctx.fx.refreshChats();
          }
        }),
      );
    }),
  );

const refreshActiveChatPins = (ctx: PollingCtx): void => {
  const chatId = ctx.get().activeChatId;
  if (chatId !== undefined && chatId !== null) {
    ctx.fx.refreshActiveChatPins(chatId);
  }
};

const pinsPolling = (ctx: PollingCtx): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* whileFocused(ctx, () => refreshActiveChatPins(ctx));
      yield* everyInterval(
        PINS_REFRESH_INTERVAL_MS,
        Effect.sync(() => {
          if (ctx.ports.visibility.isVisible()) {
            refreshActiveChatPins(ctx);
          }
        }),
      );
    }),
  );

/** Refetches `/api/chats` every 60 s while the app is visible, and on focus. */
export const startChatsPolling = (ctx: PollingCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.sync(() => {
    session.fork(chatsPolling(ctx));
  });

/** Refreshes the open chat's pins every 60 s while the app is visible, and on focus. */
export const startPinsPolling = (ctx: PollingCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.sync(() => {
    session.fork(pinsPolling(ctx));
  });

/** Turn ids whose draft is done are remembered (capped) to ignore a late `draft`. */
export function markTurnFinished(ctx: DraftTurns, turnId: string): void {
  if (ctx.finishedTurns.has(turnId)) {
    return;
  }
  ctx.finishedTurns.add(turnId);
  ctx.finishedTurnOrder.push(turnId);
  while (ctx.finishedTurnOrder.length > FINISHED_TURNS_MAX) {
    const oldest = ctx.finishedTurnOrder.shift();
    if (oldest !== undefined) {
      ctx.finishedTurns.delete(oldest);
    }
  }
}

export function clearFinishedTurns(ctx: DraftTurns): void {
  ctx.finishedTurns.clear();
  ctx.finishedTurnOrder.length = 0;
}

/** Cancels the removal timer of a chat's draft. */
export function clearDraftTimeout(ctx: PollingCtx, chatId: string): void {
  ctx.rt.cancel(draftTimerKey(chatId));
}

// (Re)arms the one removal timer of a chat, replacing any previous one. It
// removes the draft only when the same turn is still shown, so a newer
// turn's draft is never dropped by an older turn's timer.
function armDraftRemoval(ctx: PollingCtx, chatJid: string, turnId: string, delay: number): void {
  ctx.rt.forkKeyed(
    draftTimerKey(chatJid),
    Effect.sleep(delay).pipe(
      Effect.andThen(
        Effect.sync(() => {
          // Not marked finished here: an idle turn (e.g. a slow tool call) may
          // resume, and its next draft must show again. `end` marks it itself.
          ctx.set((state) => {
            const current = state.drafts[chatJid];
            if (current === undefined || current.turnId !== turnId) {
              return state;
            }
            return { drafts: withoutDraft(state.drafts, chatJid) };
          });
        }),
      ),
    ),
  );
}

function handleDraftEnd(ctx: PollingCtx, event: Extract<DraftHubEvent, { type: 'end' }>): void {
  markTurnFinished(ctx, event.turnId);
  const shown = ctx.get().drafts[event.chatJid];
  if (shown === undefined || shown.turnId !== event.turnId) {
    return;
  }
  armDraftRemoval(ctx, event.chatJid, event.turnId, DRAFT_END_FALLBACK_MS);
}

// A draft disappears only once its final message is there, so the two never
// leave a gap. Each `draft` re-arms an idle timer (a dead turn, e.g. the
// server restarted mid-turn, would otherwise leave the bubble forever); `end`
// replaces it with the short fallback; the final XMPP message (a separate
// channel) removes the draft in the same update that adds it.
function handleDraftEvent(ctx: PollingCtx, event: DraftHubEvent): void {
  if (event.type === 'end') {
    handleDraftEnd(ctx, event);
    return;
  }
  if (ctx.finishedTurns.has(event.turnId)) {
    return;
  }
  ctx.set((state) => ({
    drafts: { ...state.drafts, [event.chatJid]: { turnId: event.turnId, text: event.text } },
  }));
  armDraftRemoval(ctx, event.chatJid, event.turnId, DRAFT_IDLE_MS);
}

/** Opens the AI draft stream once for the store; it closes when the store Scope does. */
export const startDraftStream = (ctx: PollingCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.sync(() => {
    if (ctx.rt.session() !== session || ctx.rt.has(DRAFT_STREAM_KEY)) {
      return;
    }
    ctx.rt.forkKeyed(
      DRAFT_STREAM_KEY,
      Effect.scoped(
        Effect.gen(function* () {
          const open = ctx.ports.drafts;
          yield* Effect.acquireRelease(
            Effect.sync(() => open((event) => handleDraftEvent(ctx, event))),
            (close) => Effect.sync(close),
          );
          yield* Effect.never;
        }),
      ),
    );
  });
