import { FINISHED_TURNS_MAX, withoutDraft } from '@zilar/client-core/store';
import { Effect, Fiber, Schedule, Scope } from 'effect';

import type { DraftEndEvent, DraftHubEvent } from '../../lib/drafts';
import { closeScope, onClose, type StoreCtx } from './runtime';

/** Refetch `/api/chats` every 60 s while the app is active (T-0112). */
export const TOPIC_REFRESH_INTERVAL_MS = 60_000;

/** Refetch pins while a chat is open, same cadence as the topic poll. */
export const PINS_REFRESH_INTERVAL_MS = 60_000;

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

// Finished turn ids are remembered only to ignore a late `draft`. The set is
// capped so it cannot grow for the life of the app session.
export { FINISHED_TURNS_MAX, withoutDraft };

export interface Polling {
  /** The 60 s poll for new and removed topics, plus its resume listener. */
  startTopicsPolling(): void;
  /** The pins poll of the open chat; a new one replaces the old. */
  startPinsPolling(chatId: string): void;
  /** Ends the pins poll of the open chat; a no-op when nothing polls. */
  stopPinsPolling(): void;
  /** Opens the AI draft stream once per session. */
  startDraftStream(): void;
  /** Remembers a finished turn so a late `draft` for it is ignored. */
  markTurnFinished(turnId: string): void;
  clearDraftTimeout(chatId: string): void;
  /** Drops the draft timers and the finished-turn memory. */
  clearDraftState(): void;
}

/**
 * The loops of the store, as fibers of the scope that owns them: a poll runs
 * `Effect.repeat` with `Schedule.spaced` inside the generation, the draft
 * stream and the draft removal timers live as long as the session. Closing
 * the scope interrupts them, which is all `stop()` needs to do.
 */
export function makePolling(ctx: StoreCtx): Polling {
  const { ports, get, set, life, h, fx } = ctx;

  // A poll that survives a throw: a defect in one tick is dropped, the next runs.
  const everyDelayed = (tick: () => void, interval: number): Effect.Effect<void> =>
    Effect.repeat(
      Effect.sync(tick).pipe(Effect.catchDefect(() => Effect.void)),
      Schedule.spaced(interval),
    ).pipe(Effect.delay(interval), Effect.asVoid);

  let topicsScope: Scope.Closeable | undefined;
  let pinsScope: Scope.Closeable | undefined;

  function startTopicsPolling(): void {
    if (topicsScope !== undefined) {
      closeScope(topicsScope);
    }
    const generation = life.generation();
    const scope = Scope.forkUnsafe(generation);
    topicsScope = scope;
    const refresh = (): void => {
      ctx.fork(fx.refreshChats, generation);
    };
    ctx.fork(
      everyDelayed(() => {
        if (!h.isVisible()) {
          return;
        }
        refresh();
      }, TOPIC_REFRESH_INTERVAL_MS),
      scope,
    );
    onClose(
      scope,
      ports.appState.subscribe((state) => {
        if (state === 'active') {
          refresh();
        }
      }),
    );
  }

  function stopPinsPolling(): void {
    if (pinsScope !== undefined) {
      closeScope(pinsScope);
      pinsScope = undefined;
    }
  }

  function startPinsPolling(chatId: string): void {
    stopPinsPolling();
    const generation = life.generation();
    const scope = Scope.forkUnsafe(generation);
    pinsScope = scope;
    ctx.fork(
      everyDelayed(() => {
        if (get().activeChatId !== chatId) {
          return;
        }
        if (!h.isVisible()) {
          return;
        }
        ctx.fork(fx.loadPins(chatId, false), generation);
      }, PINS_REFRESH_INTERVAL_MS),
      scope,
    );
    onClose(
      scope,
      ports.appState.subscribe((state) => {
        if (state === 'active' && get().activeChatId === chatId) {
          ctx.fork(fx.loadPins(chatId, false), generation);
        }
      }),
    );
  }

  // Turn ids whose draft is done, so a late `draft` is ignored.
  const finishedTurns = new Set<string>();
  const finishedTurnOrder: string[] = [];
  // Idle/fallback removal of a draft, one timer fiber per chat id.
  const draftTimeouts = new Map<string, Fiber.Fiber<void>>();
  let draftStreamOpen = false;

  function markTurnFinished(turnId: string): void {
    if (finishedTurns.has(turnId)) {
      return;
    }
    finishedTurns.add(turnId);
    finishedTurnOrder.push(turnId);
    while (finishedTurnOrder.length > FINISHED_TURNS_MAX) {
      const oldest = finishedTurnOrder.shift();
      if (oldest !== undefined) {
        finishedTurns.delete(oldest);
      }
    }
  }

  function clearDraftTimeout(chatId: string): void {
    const timer = draftTimeouts.get(chatId);
    if (timer !== undefined) {
      Effect.runFork(Fiber.interrupt(timer));
      draftTimeouts.delete(chatId);
    }
  }

  function clearDraftState(): void {
    for (const timer of draftTimeouts.values()) {
      Effect.runFork(Fiber.interrupt(timer));
    }
    draftTimeouts.clear();
    finishedTurns.clear();
    finishedTurnOrder.length = 0;
  }

  // (Re)arms the one removal timer of a chat, replacing any previous one. It
  // removes the draft only when the same turn is still shown, so a newer
  // turn's draft is never dropped by an older turn's timer.
  function armDraftRemoval(chatJid: string, turnId: string, delay: number): void {
    clearDraftTimeout(chatJid);
    const timer = ctx.fork(
      Effect.sleep(delay).pipe(
        Effect.andThen(
          Effect.sync(() => {
            draftTimeouts.delete(chatJid);
            // Not marked finished here: an idle turn (e.g. a slow tool call) may
            // resume, and its next draft must show again. `end` marks it itself.
            set((state) => {
              const current = state.drafts[chatJid];
              if (current === undefined || current.turnId !== turnId) {
                return state;
              }
              return { drafts: withoutDraft(state.drafts, chatJid) };
            });
          }),
        ),
      ),
      life.session(),
    );
    draftTimeouts.set(chatJid, timer);
  }

  // A draft disappears only once its final message is there, so the two never
  // leave a gap. Each `draft` re-arms an idle timer (a dead turn, e.g. the
  // server restarted mid-turn, would otherwise leave the bubble forever);
  // `end` replaces it with the short fallback; the final XMPP message (a
  // separate channel) removes the draft in the same update that adds it.
  function handleDraftEvent(event: DraftHubEvent): void {
    if (event.type === 'end') {
      handleDraftEnd(event);
      return;
    }
    if (finishedTurns.has(event.turnId)) {
      return;
    }
    set((state) => ({
      drafts: { ...state.drafts, [event.chatJid]: { turnId: event.turnId, text: event.text } },
    }));
    armDraftRemoval(event.chatJid, event.turnId, DRAFT_IDLE_MS);
  }

  function handleDraftEnd(event: DraftEndEvent): void {
    markTurnFinished(event.turnId);
    const shown = get().drafts[event.chatJid];
    if (shown === undefined || shown.turnId !== event.turnId) {
      return;
    }
    armDraftRemoval(event.chatJid, event.turnId, DRAFT_END_FALLBACK_MS);
  }

  function startDraftStream(): void {
    if (draftStreamOpen) {
      return;
    }
    const close = ports.openDrafts(handleDraftEvent);
    draftStreamOpen = true;
    onClose(life.session(), () => {
      close();
      draftStreamOpen = false;
    });
  }

  return {
    startTopicsPolling,
    startPinsPolling,
    stopPinsPolling,
    startDraftStream,
    markTurnFinished,
    clearDraftTimeout,
    clearDraftState,
  };
}
