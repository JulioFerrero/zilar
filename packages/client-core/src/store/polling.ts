// Background loops of the store, shared by both apps: the 60 s chat list poll
// and the open chat's pins poll (both also run on focus). Loops are forked
// into a Scope, so they stop when it closes. The app supplies the two refreshes
// through its hooks and ports. The AI draft stream lives in `./draft-stream`.
import { Effect, type Scope } from 'effect';
import type { CoreCtx, StoreAppHooks } from './ctx';
import type { DraftTurns } from './draft-stream';
import { everyInterval } from './draft-stream';
import type { HistoryCtx } from './history';
import type { Fibers } from './lifetime';
import { recordRead } from './reads';
import { coreKind } from './rows';

export * from './draft-stream';

// Refetch `/api/chats` every 60 s while the tab is visible, and on focus.
export const TOPIC_REFRESH_INTERVAL_MS = 60_000;
// T-0114: the open chat's pins refresh on the same cadence (no realtime channel).
export const PINS_REFRESH_INTERVAL_MS = 60_000;
// T-1449 (PERF-11): while XMPP is online and pushes changes live, a tick still
// runs every 60 s but refetches only every 5 min; a focus or push still refreshes.
export const ONLINE_REFRESH_INTERVAL_MS = 300_000;

// PERF-11: a focus refresh right after a poll is wasted. A poll that ran within
// this window coalesces the next focus refresh into it (both the chat list and
// the pins poll).
export const CHAT_REFRESH_COALESCE_MS = 10_000;
// PERF-11: roster, invitation and removal pushes arrive in bursts (one per
// room or roster entry). One refresh per burst is enough.
export const ROSTER_REFRESH_DEBOUNCE_MS = 2_000;

const ROSTER_REFRESH_KEY = 'roster-refresh';

export interface PollingCtx extends HistoryCtx, DraftTurns {
  readonly fx: StoreAppHooks;
}

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
  const lastMessage = chat.lastMessage;
  // The read mark is the archive id when the preview came from the server
  // (its `id` is the origin id, which the server answers 400 for); the
  // displayed marker keeps the origin id, as before.
  recordRead(ctx, chatId, lastMessage?.archiveId ?? lastMessage?.id);
  if (lastMessage !== undefined && ctx.core !== undefined) {
    ctx.core.markDisplayed(chatId, coreKind(chat), lastMessage.id);
  }
}

/** A refresh that ran, and the time it ran at, so a later one can be gated. */
interface RefreshGate {
  readonly ifStale: () => void;
  readonly ifDue: () => void;
}

// PERF-11: wraps a refresh so it is skipped when the previous one is younger
// than `minAgeMs`. `ifStale` (a focus or a push) coalesces into a poll within
// `CHAT_REFRESH_COALESCE_MS`; `ifDue` (a 60 s tick) waits
// `ONLINE_REFRESH_INTERVAL_MS` while XMPP is online, whose pushes keep the
// state fresh, and falls back to the coalesce window otherwise (T-1449).
function refreshGate(ctx: PollingCtx, refresh: () => void): RefreshGate {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  const run = (minAgeMs: number): void => {
    const now = ctx.ports.now().getTime();
    if (now - lastRunAt < minAgeMs) {
      return;
    }
    lastRunAt = now;
    refresh();
  };
  const dueMinAgeMs = (): number =>
    ctx.connectionStatus === 'online' ? ONLINE_REFRESH_INTERVAL_MS : CHAT_REFRESH_COALESCE_MS;
  return {
    ifStale: () => run(CHAT_REFRESH_COALESCE_MS),
    ifDue: () => run(dueMinAgeMs()),
  };
}

const chatsPolling = (ctx: PollingCtx): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const refresh = refreshGate(ctx, () => ctx.fx.refreshChats());
      yield* whileFocused(ctx, () => {
        refresh.ifStale();
        clearActiveChatRead(ctx);
      });
      yield* everyInterval(
        TOPIC_REFRESH_INTERVAL_MS,
        Effect.sync(() => {
          if (ctx.ports.visibility.isVisible()) {
            refresh.ifDue();
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
      const refresh = refreshGate(ctx, () => refreshActiveChatPins(ctx));
      yield* whileFocused(ctx, () => refresh.ifStale());
      yield* everyInterval(
        PINS_REFRESH_INTERVAL_MS,
        Effect.sync(() => {
          if (ctx.ports.visibility.isVisible()) {
            refresh.ifDue();
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

/**
 * PERF-11: handles one roster, invitation or removal push. The first push of a
 * burst refreshes at once; the rest are dropped until the burst window closes,
 * so a room's member list settling costs the server one `/api/chats`, not one
 * per entry. The window is a store-scoped timer, so it dies with `stop()`.
 */
export function scheduleChatsRefreshBurst(ctx: PollingCtx): void {
  if (ctx.rt.has(ROSTER_REFRESH_KEY)) {
    return;
  }
  ctx.fx.scheduleChatsRefresh();
  ctx.rt.forkKeyed(ROSTER_REFRESH_KEY, Effect.sleep(ROSTER_REFRESH_DEBOUNCE_MS));
}
