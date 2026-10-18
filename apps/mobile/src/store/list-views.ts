/** "empty" is not a load state: it is what a finished load with no rows looks like. */
export type LoadState = 'loading' | 'loaded' | 'error';

export type DraftState = {
  turnId: string;
  text: string;
};

/** A message that finished a draft keeps the draft's `draft-<turnId>` key, so the bubble is reused and its reveal carries over instead of snapping in. */
export function draftEntryKey(
  messageId: string,
  finishedDraftMessages: Record<string, string>,
): string {
  const turnId = finishedDraftMessages[messageId];
  return turnId === undefined ? messageId : `draft-${turnId}`;
}

export type ChatsListView = 'skeleton' | 'error' | 'empty' | 'list';

/** A load that never showed rows gets the skeleton, a failure with no rows the centered Retry, and the empty text only once a load has settled. */
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

export type MessagesListView = 'skeleton' | 'error' | 'empty' | 'messages';

/** The message list's view state; live messages override loading. */
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

/** A filtered or searched list that matched nothing says "No chats found"; a list with no chats at all says "No chats yet". */
export function emptyChatsText(chatCount: number): string {
  return chatCount === 0 ? 'No chats yet' : 'No chats found';
}
