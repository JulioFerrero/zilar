// The store's AI draft stream: the draft-turn bookkeeping, the timers that drop
// a finished or stale draft, and the loop that opens the stream while the user
// has an AI chat and closes it when none is left. It is forked into a Scope, so
// it stops when the Scope closes. The app supplies the stream through its ports.
import type { ChatSummary } from '@zilar/chat-core';
import { Effect, Schedule } from 'effect';
import type { CoreSet } from './ctx';
import type { Fibers } from './lifetime';
import type { PollingCtx } from './polling';
import type { DraftHubEvent } from './ports';
import { FINISHED_TURNS_MAX, withoutDraft } from './rows';

// A finished draft is kept until its final XMPP message arrives. If that never
// happens (XMPP down), it is dropped after this long so it cannot stick.
export const DRAFT_END_FALLBACK_MS = 5_000;

// A draft that sees no further event for this long is stale (e.g. the server
// restarted mid-turn); the idle timer drops it rather than leaving it forever.
export const DRAFT_IDLE_MS = 60_000;

// The store has no state subscription, and an app may write its chats through
// a view other than the polling context (mobile's history view), so the draft
// stream is reconciled on this short interval as a fallback beside the
// `ctx.set` hook: the first AI chat opens the stream within a second instead
// of waiting for the 60 s chat-list poll.
export const DRAFT_STREAM_WATCH_MS = 1_000;

const DRAFT_STREAM_KEY = 'draft-stream';

const draftTimerKey = (chatId: string): string => `draft:${chatId}`;

/** The draft-turn bookkeeping a polling context needs beside the history state. */
export interface DraftTurns {
  readonly finishedTurns: Set<string>;
  readonly finishedTurnOrder: string[];
}

// One tick every `intervalMs`, the first one after the first wait (like a
// `setInterval`). A defect in a tick is logged and the loop goes on.
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

// The chat's newest message that the AI wrote. Its body is the final text of
// the turn; a draft frame that already equals it carries nothing new.
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
  // A finished turn is known from `finishedTurns`: `end` marks it here, and
  // the final AI message marks it through the `finishDraftTurn` hook when a
  // draft was shown (`incoming.ts`).
  if (ctx.finishedTurns.has(event.turnId)) {
    return;
  }
  // The final message lands over XMPP, a separate channel from the SSE frame
  // (AI-13): if it arrived first, this frame would render below it until the
  // fallback. Drop the frame when its text is already the newest AI message.
  if (event.text === newestAiText(ctx, event.chatJid)) {
    return;
  }
  ctx.set((state) => ({
    drafts: { ...state.drafts, [event.chatJid]: { turnId: event.turnId, text: event.text } },
  }));
  armDraftRemoval(ctx, event.chatJid, event.turnId, DRAFT_IDLE_MS);
}

// Opens the store's one AI draft stream when the user has at least one AI chat,
// and closes it when none is left (PERF-9). A user with no AI chat keeps no
// long-lived connection.
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

// The store has no state subscription, so the draft stream follows the chat
// list through the store's one write point (`ctx.set`): a refresh that
// finishes, or a chat added locally, opens or closes the stream at once
// instead of waiting for the next poll tick. The AI-chat check runs only when
// the chat list is a new array, so an unrelated write costs one comparison.
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

/** Opens the AI draft stream for the store; it closes when the store Scope does. */
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
