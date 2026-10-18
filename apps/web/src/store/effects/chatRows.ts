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

/** Fresh server entries merged over the painted list: a server row at least as new replaces
 * the preview and unread count (a read elsewhere clears here), a newer painted preview wins.
 * A cached list that belongs to another user is dropped. */
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
