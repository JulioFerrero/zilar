// The store's AI draft stream: turn bookkeeping, drop timers and the open/close loop,
// forked into a Scope. The app supplies the stream through its ports.
import type { ChatSummary } from '@zilar/chat-core';
import { Effect, Schedule } from 'effect';
import type { CoreSet } from './ctx';
import type { Fibers } from './lifetime';
import type { PollingCtx } from './polling';
import type { DraftHubEvent } from './ports';
import { FINISHED_TURNS_MAX, withoutDraft } from './rows';

// A finished draft is kept until its final XMPP message arrives; if XMPP is down, it is
// dropped after this long.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft with no event for this long is stale (e.g. the server restarted mid-turn), so the
// idle timer drops it.
export const DRAFT_IDLE_MS = 60_000;

// The store has no state subscription, and mobile may write chats through its history view,
// so the stream is reconciled on this short interval beside the `ctx.set` hook.
export const DRAFT_STREAM_WATCH_MS = 1_000;

const DRAFT_STREAM_KEY = 'draft-stream';

const draftTimerKey = (chatId: string): string => `draft:${chatId}`;

export interface DraftTurns {
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
}

// One tick every `intervalMs`, the first after one wait; a defect in a tick is logged and the
// loop goes on.
export const everyInterval = (intervalMs: number, tick: Effect.Effect<void>): Effect.Effect<void> =>
  tick.pipe(
    Effect.catchDefect((defect) => Effect.logError('chat store poll failed', defect)),
    Effect.repeat(Schedule.spaced(intervalMs)),
    Effect.delay(intervalMs),
    Effect.asVoid,
  );

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

export function clearDraftTimeout(ctx: PollingCtx, chatId: string): void {
  ctx.rt.cancel(draftTimerKey(chatId));
}

// (Re)arms the one removal timer of a chat; it removes the draft only when the same turn is
// still shown, so a newer turn's draft is never dropped by an older turn's timer.
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

function newestAiText(ctx: PollingCtx, chatJid: string): string | undefined {
  let newestText: string | undefined;
  let newestAt: number | undefined;
  for (const message of ctx.get().messagesByChat[chatJid] ?? []) {
    if (message.senderId !== chatJid) {
      continue;
    }
    const at = message.createdAt.getTime();
    if (newestAt === undefined || at >= newestAt) {
      newestAt = at;
      newestText = message.text;
    }
  }
  return newestText;
}

// A draft disappears only once its final message is there, so the two never leave a gap.
// Each `draft` re-arms an idle timer; `end` replaces it with the short fallback.
function handleDraftEvent(ctx: PollingCtx, event: DraftHubEvent): void {
  if (event.type === 'end') {
    handleDraftEnd(ctx, event);
    return;
  }
  // A finished turn is known from `finishedTurns`: `end` marks it here, and the final AI
  // message marks it through `finishDraftTurn`.
  if (ctx.finishedTurns.has(event.turnId)) {
    return;
  }
  // The final message lands over XMPP, a separate channel: if it arrived first, drop this
  // frame so it never renders below it.
  if (event.text === newestAiText(ctx, event.chatJid)) {
    return;
  }
  ctx.set((state) => ({
    drafts: { ...state.drafts, [event.chatJid]: { turnId: event.turnId, text: event.text } },
  }));
  armDraftRemoval(ctx, event.chatJid, event.turnId, DRAFT_IDLE_MS);
}

// Opens the one AI draft stream when the user has at least one AI chat, and closes it when
// none is left, so no long-lived connection stays.
function syncDraftStream(ctx: PollingCtx, session: Fibers<never>): void {
  if (ctx.rt.session() !== session) {
    return;
  }
  const hasAi = hasAiChat(ctx.get().chats);
  const isOpen = ctx.rt.has(DRAFT_STREAM_KEY);
  if (!hasAi) {
    if (isOpen) {
      ctx.rt.cancel(DRAFT_STREAM_KEY);
    }
    return;
  }
  if (isOpen) {
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
}

// The stream follows the chat list through the store's one write point (`ctx.set`), so a
// refresh or a local add opens or closes it at once. The AI-chat check runs only when the
// list is a new array.
const draftWatchers = new WeakMap<
  PollingCtx,
  { session: Fibers<never>; chats: readonly ChatSummary[]; hasAiChat: boolean }
>();

function hasAiChat(chats: readonly ChatSummary[]): boolean {
  return chats.some((chat) => chat.isAI);
}

function watchChats(ctx: PollingCtx, session: Fibers<never>): void {
  const existing = draftWatchers.get(ctx);
  if (existing !== undefined) {
    existing.session = session;
    return;
  }
  const chats = ctx.get().chats;
  const watch = { session, chats, hasAiChat: hasAiChat(chats) };
  draftWatchers.set(ctx, watch);
  const set = ctx.set;
  const target = ctx as { set: CoreSet };
  target.set = (update) => {
    set(update);
    const next = ctx.get().chats;
    if (next === watch.chats) {
      return;
    }
    watch.chats = next;
    const nextHasAiChat = hasAiChat(next);
    if (nextHasAiChat === watch.hasAiChat) {
      return;
    }
    watch.hasAiChat = nextHasAiChat;
    syncDraftStream(ctx, watch.session);
  };
}

export const startDraftStream = (ctx: PollingCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.sync(() => {
    watchChats(ctx, session);
    syncDraftStream(ctx, session);
    // Fallback for a chat write that bypasses `ctx.set` (see the constant).
    session.fork(
      everyInterval(
        DRAFT_STREAM_WATCH_MS,
        Effect.sync(() => syncDraftStream(ctx, session)),
      ),
    );
  });
