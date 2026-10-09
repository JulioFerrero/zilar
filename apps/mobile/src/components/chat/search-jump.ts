import type { UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';

/**
 * The search-jump retry driver (T-0138/T-0157), kept UI-free next to the list
 * so it can be unit-tested in Node: `MessageSearchList` only wires the store
 * and the router to this.
 *
 * A tap on a search hit calls `openAtMessage`, which pages backwards through
 * history until the hit loads or gives up. On failure the chat still opens —
 * at its bottom, with `?notFound=1` — instead of leaving the user on the
 * search list. The retry loop below is that give-up path's contract: at most
 * `MESSAGE_JUMP_MAX_PAGES` page loads, then the bottom landing.
 */

export interface SearchJumpDeps {
  /** Pages backwards until the message loads; throws `message_not_found`. */
  openAtMessage: (chatId: string, messageId: string) => Promise<UiMessage>;
  /** Opens the chat (or topic) at the landed message. */
  pushChat: (chatId: string) => void;
  /** Opens the chat at its bottom with the "Message not found" notice. */
  pushChatNotFound: (chatId: string) => void;
  /** Reports the miss to the search screen (dismisses the spinner). */
  onNotFound: (chatId: string) => void;
}

/**
 * Opens one search hit: `openAtMessage` does the paging (capped by
 * `MESSAGE_JUMP_MAX_PAGES` inside the store, like web); success lands on the
 * message, failure lands at the bottom with the notice — never a loop. Only
 * the not-found signal lands at the bottom: any other error (a programming
 * bug, a router failure) propagates to the caller instead of silently
 * mis-landing the user.
 */
export function openSearchHitEffect(
  deps: SearchJumpDeps,
  chatId: string,
  messageId: string,
): Effect.Effect<'landed' | 'not-found', unknown> {
  return Effect.tryPromise({
    try: () => deps.openAtMessage(chatId, messageId),
    catch: (error) => error,
  }).pipe(
    Effect.matchEffect({
      onSuccess: () =>
        Effect.sync(() => {
          deps.pushChat(chatId);
          return 'landed' as const;
        }),
      onFailure: (error) => {
        if (!isMessageNotFound(error)) {
          return Effect.fail(error);
        }
        return Effect.sync(() => {
          deps.pushChatNotFound(chatId);
          deps.onNotFound(chatId);
          return 'not-found' as const;
        });
      },
    }),
  );
}

/** The Promise edge for the list: a rejection carries the original error. */
export const openSearchHit = (
  deps: SearchJumpDeps,
  chatId: string,
  messageId: string,
): Promise<'landed' | 'not-found'> =>
  Effect.runPromise(openSearchHitEffect(deps, chatId, messageId));

/** The store's give-up signal: history ran out (or the page cap hit). */
function isMessageNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === 'message_not_found';
}
