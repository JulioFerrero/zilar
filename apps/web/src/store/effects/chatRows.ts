// Pure mappers from `/api/chats` entries to chat rows. No state, no Effect.
// The entry-to-row mapping is the shared core `summariesFor` (T-0924); this
// module re-exports it and keeps web's web-only `mergeWithPainted`.
import type { ChatSummary } from '@zilar/chat-core';
import { sortByRecency } from '@zilar/client-core/store';

export {
  advanceStatus,
  clearFailure,
  coreKind,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortByRecency,
  sortMessages,
  summariesFor,
} from '@zilar/client-core/store';

/**
 * Fresh server entries merged over what is already painted (the cached list
 * from the last visit): each chat keeps its preview and unread count, so rows
 * don't lose their second line or jump while XMPP catches up. A cached list
 * that belongs to another user is dropped.
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
  return sortByRecency(
    fresh.map((chat) => {
      const previous = byId.get(chat.id);
      if (previous === undefined) {
        return chat;
      }
      const merged: ChatSummary = { ...chat, unread: previous.unread };
      if (previous.lastMessage !== undefined) {
        merged.lastMessage = previous.lastMessage;
      }
      return merged;
    }),
  );
}
