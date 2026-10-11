/**
 * The quiet load-state helpers of the mobile store (T-0067), split out of
 * `types.ts` by T-1095. Every name is re-exported from `types.ts`, so
 * importers are unchanged.
 */

/**
 * A quiet load state (T-0067): `loading` until the data has actually arrived,
 * `error` when it failed, `loaded` once it is known. "empty" is not a load
 * state; it is what a finished load with no rows looks like.
 */
export type LoadState = 'loading' | 'loaded' | 'error';

/** The live AI draft of one chat: the latest cumulative reply text. */
export type DraftState = {
  turnId: string;
  text: string;
};

/**
 * The list key of a message (T-0056). A message that finished a draft keeps the
 * draft's `draft-<turnId>` key, so the bubble component is reused and its reveal
 * carries over instead of snapping in as a new message.
 */
export function draftEntryKey(
  messageId: string,
  finishedDraftMessages: Record<string, string>,
): string {
  const turnId = finishedDraftMessages[messageId];
  return turnId === undefined ? messageId : `draft-${turnId}`;
}

/** What the chat list shows for its current load state and row count. */
export type ChatsListView = 'skeleton' | 'error' | 'empty' | 'list';

/**
 * The chat list's view state (T-0067): a load that has never shown rows gets
 * the skeleton, a failure with no rows the centered Retry, and the empty text
 * only once a load has settled. Rows already shown keep the list.
 */
export function chatsListView(load: LoadState, chatCount: number): ChatsListView {
  if (chatCount > 0) {
    return 'list';
  }
  if (load === 'loading') {
    return 'skeleton';
  }
  if (load === 'error') {
    return 'error';
  }
  return 'empty';
}

/** What the chat screen shows for its current load state and message count. */
export type MessagesListView = 'skeleton' | 'error' | 'empty' | 'messages';

/** The message list's view state (T-0067); live messages override loading. */
export function messagesListView(load: LoadState, messageCount: number): MessagesListView {
  if (messageCount > 0) {
    return 'messages';
  }
  if (load === 'loading') {
    return 'skeleton';
  }
  if (load === 'error') {
    return 'error';
  }
  return 'empty';
}

/**
 * The empty-list text. A filtered or searched list that matched nothing says
 * "No chats found"; a list with no chats at all says "No chats yet" (T-0067).
 */
export function emptyChatsText(chatCount: number): string {
  return chatCount === 0 ? 'No chats yet' : 'No chats found';
}
