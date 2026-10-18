import { Effect, type Scope } from 'effect';
import type { CoreCtx, StoreAppHooks } from './ctx';
import type { DraftTurns } from './draft-stream';
import { everyInterval } from './draft-stream';
import type { HistoryCtx } from './history';
import type { Fibers } from './lifetime';
import { recordRead } from './reads';
import { coreKind } from './rows';

export * from './draft-stream';

export const TOPIC_REFRESH_INTERVAL_MS = 60_000;
export const PINS_REFRESH_INTERVAL_MS = 60_000;
// While XMPP is online and pushes live, a tick still runs every 60 s but refetches every
// 5 min; a focus or a push still refreshes.
export const ONLINE_REFRESH_INTERVAL_MS = 300_000;

// A focus refresh right after a poll is wasted: a poll within this window coalesces the
// next focus refresh into it.
export const CHAT_REFRESH_COALESCE_MS = 10_000;
// Roster, invitation and removal pushes arrive in bursts; one refresh per burst is enough.
export const ROSTER_REFRESH_DEBOUNCE_MS = 2_000;

const ROSTER_REFRESH_KEY = 'roster-refresh';

export interface PollingCtx extends HistoryCtx, DraftTurns {
  readonly fx: StoreAppHooks;
}

const whileFocused = (
  ctx: PollingCtx,
  onFocus: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => ctx.ports.visibility.onFocus(onFocus)),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

// Coming back to a chat that collected messages while the app was hidden clears its unread
// at once with the same recordRead + marker pair that opening the chat uses.
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
  // The read mark is the archive id when the preview came from the server (its `id` is the
  // origin id, which the server answers 400 for); the displayed marker keeps the origin id.
  recordRead(ctx, chatId, lastMessage?.archiveId ?? lastMessage?.id);
  if (lastMessage !== undefined && ctx.core !== undefined) {
    ctx.core.markDisplayed(chatId, coreKind(chat), lastMessage.id);
  }
}

interface RefreshGate {
  readonly ifStale: () => void;
  readonly ifDue: () => void;
}

// Wraps a refresh so it is skipped when the previous one is younger than `minAgeMs`:
// `ifStale` (a focus or push) coalesces into a poll within the window; `ifDue` (a 60 s
// tick) waits `ONLINE_REFRESH_INTERVAL_MS` while XMPP is online and falls back otherwise.
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

export const startChatsPolling = (ctx: PollingCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.sync(() => {
    session.fork(chatsPolling(ctx));
  });

export const startPinsPolling = (ctx: PollingCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.sync(() => {
    session.fork(pinsPolling(ctx));
  });

/**
 * Handles one roster, invitation or removal push: the first refreshes at once, the rest
 * are dropped until the burst window closes, so a room settling costs one `/api/chats`,
 * not one per entry. The window is a store-scoped timer.
 */
export function scheduleChatsRefreshBurst(ctx: PollingCtx): void {
  if (ctx.rt.has(ROSTER_REFRESH_KEY)) {
    return;
  }
  ctx.fx.scheduleChatsRefresh();
  ctx.rt.forkKeyed(ROSTER_REFRESH_KEY, Effect.sleep(ROSTER_REFRESH_DEBOUNCE_MS));
}
