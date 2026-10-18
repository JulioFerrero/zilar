import { Effect } from 'effect';
import type { ChatSummary } from '@zilar/chat-core';
import type { CoreCtx, CorePatch, CoreState } from './ctx';

export const PREVIEW_HISTORY_MAX = 1;
export const PAGE_HISTORY_MAX = 50;
// Message search jumps at most this many history pages back looking for the
// hit before giving up with "Message not found".
export const MESSAGE_JUMP_MAX_PAGES = 20;
// Upper bound for one stalled history wait inside `openAtMessage`: after this
// the jump gives up with "Message not found" instead of hanging.
export const MESSAGE_JUMP_WAIT_MS = 10_000;
const HISTORY_POLL_MS = 25;

export type HistoryLoad = 'loading' | 'ready' | 'error';

export interface HistoryState extends CoreState {
  readonly status: string;
  readonly historyState: Record<string, HistoryLoad>;
  readonly historyComplete: Record<string, boolean>;
  readonly openChat: (chatId: string) => void;
}

export interface HistoryPatch extends CorePatch {
  historyState?: Record<string, HistoryLoad>;
  historyComplete?: Record<string, boolean>;
}

export type HistorySet = (update: HistoryPatch | ((state: HistoryState) => HistoryPatch)) => void;

/**
 * Keeps the first copy of each message of one page: the server can archive a resend twice,
 * both rows carry one origin id and the ledger aliases them, so dropping the second is what
 * leaves one bubble.
 */
export const dedupePage = <T extends { readonly id: string }>(
  sameMessage: (left: string, right: string) => boolean,
  messages: readonly T[],
): T[] => {
  const kept: T[] = [];
  for (const message of messages) {
    if (!kept.some((item) => sameMessage(item.id, message.id))) {
      kept.push(message);
    }
  }
  return kept;
};

export interface HistoryCtx extends CoreCtx {
  readonly get: () => HistoryState;
  readonly set: HistorySet;
  /** Group history (MUC MAM) only works once the rooms are joined. */
  groupsJoined: boolean;
  /**
   * The group rooms joined so far: a chat's own history can load right after its room
   * joins, without waiting for every room.
   */
  joinedRooms?: Set<string>;
  pendingOpenChatId: string | undefined;
  readonly cursors: Record<string, string | undefined>;
  readonly loadingHistory: Set<string>;
  readonly loadingOlder: Set<string>;
}

export const setHistoryState = (ctx: HistoryCtx, chatId: string, state: HistoryLoad): void => {
  ctx.set((previous) => ({ historyState: { ...previous.historyState, [chatId]: state } }));
};

/**
 * Drops the 'loading' marker of a pending chat superseded before it ever loaded, so no
 * ownerless entry stays behind. Settled entries and in-flight loads are left alone.
 */
export const clearSupersededMarker = (ctx: HistoryCtx, chatId: string): void => {
  if (ctx.loadingHistory.has(chatId)) {
    return;
  }
  ctx.set((previous) => {
    if (previous.historyState[chatId] !== 'loading') {
      return previous;
    }
    const next = { ...previous.historyState };
    delete next[chatId];
    return { historyState: next };
  });
};

export const canLoadHistory = (ctx: HistoryCtx, chat: ChatSummary): boolean =>
  ctx.core !== undefined &&
  ctx.get().status === 'online' &&
  (chat.kind !== 'group' ||
    ctx.groupsJoined ||
    ctx.joinedRooms?.has(chat.id) === true ||
    // The mobile history adapter rebuilds the context; the set rides on fx.
    ctx.fx.joinedRooms?.has(chat.id) === true);

// Resolves true once the in-flight first-page load for a chat settles, false after
// MESSAGE_JUMP_WAIT_MS so a stalled fetch cannot hang the jump.
export const waitForHistory = (ctx: HistoryCtx, chatId: string): Effect.Effect<boolean> => {
  const settled: Effect.Effect<boolean> = Effect.sleep(HISTORY_POLL_MS).pipe(
    Effect.andThen(
      Effect.suspend(() => (ctx.loadingHistory.has(chatId) ? settled : Effect.succeed(true))),
    ),
  );
  return settled.pipe(
    Effect.timeoutOrElse({
      duration: MESSAGE_JUMP_WAIT_MS,
      orElse: () => Effect.succeed(false),
    }),
  );
};
