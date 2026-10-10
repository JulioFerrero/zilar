// Background loops of the store: the 60 s chat list poll and the open chat's
// pins poll (both also run on tab focus), and the AI draft stream with the
// timers that drop a finished or stale draft. Loops are forked into a Scope,
// so they stop when it closes.
import { withoutDraft } from '@zilar/client-core/store';
import { Effect, Schedule, type Scope } from 'effect';
import type { DraftEndEvent, DraftHubEvent } from '@/lib/drafts';
import {
  DRAFT_END_FALLBACK_MS,
  DRAFT_IDLE_MS,
  FINISHED_TURNS_MAX,
  PINS_REFRESH_INTERVAL_MS,
  TOPIC_REFRESH_INTERVAL_MS,
} from './constants';
import type { StoreCtx } from './ctx';
import { refreshChats } from './history';
import { refreshPinsFor } from './pins';
import { Ports } from './ports';
import type { Fibers } from './runtime';

const DRAFT_STREAM_KEY = 'draft-stream';

const draftTimerKey = (chatId: string): string => `draft:${chatId}`;

const isTabVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

// One tick every `intervalMs`, the first one after the first wait (like a
// `setInterval`). A defect in a tick is logged and the loop goes on.
const everyInterval = (
  intervalMs: number,
  tick: Effect.Effect<void, never, Ports>,
): Effect.Effect<void, never, Ports> =>
  tick.pipe(
    Effect.catchDefect((defect) => Effect.logError('chat store poll failed', defect)),
    Effect.repeat(Schedule.spaced(intervalMs)),
    Effect.delay(intervalMs),
    Effect.asVoid,
  );

// Runs `onFocus` on every window focus while the surrounding Scope is open.
const whileFocused = (onFocus: () => void): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => window.addEventListener('focus', onFocus)),
    () => Effect.sync(() => window.removeEventListener('focus', onFocus)),
  );

const chatsPolling = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* whileFocused(() => ctx.rt.fork(refreshChats(ctx)));
      yield* everyInterval(
        TOPIC_REFRESH_INTERVAL_MS,
        Effect.sync(() => {
          if (isTabVisible()) {
            ctx.rt.fork(refreshChats(ctx));
          }
        }),
      );
    }),
  );

const refreshActiveChatPins = (ctx: StoreCtx): void => {
  const chatId = ctx.get().activeChatId;
  if (chatId !== undefined) {
    ctx.rt.fork(refreshPinsFor(ctx, chatId));
  }
};

const pinsPolling = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* whileFocused(() => refreshActiveChatPins(ctx));
      yield* everyInterval(
        PINS_REFRESH_INTERVAL_MS,
        Effect.sync(() => {
          if (isTabVisible()) {
            refreshActiveChatPins(ctx);
          }
        }),
      );
    }),
  );

/** Refetches `/api/chats` every 60 s while the tab is visible, and on focus. */
export const startChatsPolling = (ctx: StoreCtx, session: Fibers): Effect.Effect<void> =>
  Effect.sync(() => {
    if (typeof window !== 'undefined') {
      session.fork(chatsPolling(ctx));
    }
  });

/** Refreshes the open chat's pins every 60 s while the tab is visible, and on focus. */
export const startPinsPolling = (ctx: StoreCtx, session: Fibers): Effect.Effect<void> =>
  Effect.sync(() => {
    if (typeof window !== 'undefined') {
      session.fork(pinsPolling(ctx));
    }
  });

/** Turn ids whose draft is done are remembered (capped) to ignore a late `draft`. */
export function markTurnFinished(ctx: StoreCtx, turnId: string): void {
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

export function clearFinishedTurns(ctx: StoreCtx): void {
  ctx.finishedTurns.clear();
  ctx.finishedTurnOrder.length = 0;
}

export { withoutDraft };

/** Cancels the removal timer of a chat's draft. */
export function clearDraftTimeout(ctx: StoreCtx, chatId: string): void {
  ctx.rt.cancel(draftTimerKey(chatId));
}

// (Re)arms the one removal timer of a chat, replacing any previous one. It
// removes the draft only when the same turn is still shown, so a newer
// turn's draft is never dropped by an older turn's timer.
function armDraftRemoval(ctx: StoreCtx, chatJid: string, turnId: string, delay: number): void {
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

function handleDraftEnd(ctx: StoreCtx, event: DraftEndEvent): void {
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
function handleDraftEvent(ctx: StoreCtx, event: DraftHubEvent): void {
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
export const startDraftStream = (ctx: StoreCtx, session: Fibers): Effect.Effect<void> =>
  Effect.sync(() => {
    if (ctx.rt.session() !== session || ctx.rt.has(DRAFT_STREAM_KEY)) {
      return;
    }
    ctx.rt.forkKeyed(
      DRAFT_STREAM_KEY,
      Effect.scoped(
        Effect.gen(function* () {
          const { openDrafts } = yield* Ports;
          yield* Effect.acquireRelease(
            Effect.sync(() => openDrafts((event) => handleDraftEvent(ctx, event))),
            (close) => Effect.sync(close),
          );
          yield* Effect.never;
        }),
      ),
    );
  });
