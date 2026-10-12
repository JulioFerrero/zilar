// Pure mappers from `/api/chats` entries to chat rows. No state, no Effect.
// The entry-to-row mapping is the shared core `summariesFor` (T-0924); this
// module re-exports it and keeps web's web-only `mergeWithPainted`.
import type { ChatSummary } from '@zilar/chat-core';
import { mergeUnread, sortByRecency } from '@zilar/client-core/store';

export {
  advanceStatus,
  clearFailure,
  coreKind,
  mergeUnread,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortByRecency,
  sortMessages,
  summariesFor,
} from '@zilar/client-core/store';

/**
 * Fresh server entries merged over what is already painted (the cached list
 * from the last visit): the shared `mergeUnread` rule decides per row, so a
 * server row at least as new as the painted one replaces the preview and the
 * unread count (a read on another device clears here), while a newer painted
 * preview wins. A cached list that belongs to another user is dropped.
 */
export function mergeWithPainted(
  painted: readonly ChatSummary[],
  fresh: ChatSummary[],
  paintedIsSameUser: boolean,
): ChatSummary[] {
  if (!paintedIsSameUser || painted.length === 0) {
    return fresh;
  }
  const byId = new Map(painted.map((chat) => [chat.id, chat]));
  return sortByRecency(fresh.map((chat) => mergeUnread(chat, byId.get(chat.id), undefined)));
}
