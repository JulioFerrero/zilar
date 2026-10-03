import type { UiMessage } from '@zilar/chat-core';

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
 * message, failure lands at the bottom with the notice — never a loop.
 */
export async function openSearchHit(
  deps: SearchJumpDeps,
  chatId: string,
  messageId: string,
): Promise<'landed' | 'not-found'> {
  try {
    await deps.openAtMessage(chatId, messageId);
  } catch {
    deps.pushChatNotFound(chatId);
    deps.onNotFound(chatId);
    return 'not-found';
  }
  deps.pushChat(chatId);
  return 'landed';
}
