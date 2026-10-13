import type { ChatSummary } from './types';

/**
 * The time a chat sorts by (T-1318): its newest message, else when it was
 * created or joined, else the oldest. A chat with messages is never moved by
 * its creation time, so a just-created group with no messages still leads the
 * list like Telegram.
 */
export function chatSortTime(chat: ChatSummary): number {
  return (
    chat.lastMessage?.createdAt.getTime() ?? chat.createdAt?.getTime() ?? Number.NEGATIVE_INFINITY
  );
}

/** Topics of one group: pinned first (newer pins first), then General, then newest message. */
export function sortTopics(topics: readonly ChatSummary[]): ChatSummary[] {
  return [...topics].sort((left, right) => {
    const leftPinned = left.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightPinned = right.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }
    if (leftPinned !== Number.NEGATIVE_INFINITY) {
      return left.title.localeCompare(right.title);
    }
    const leftGeneral = left.topic?.isGeneral === true;
    const rightGeneral = right.topic?.isGeneral === true;
    if (leftGeneral !== rightGeneral) {
      return leftGeneral ? -1 : 1;
    }
    return chatSortTime(right) - chatSortTime(left) || left.title.localeCompare(right.title);
  });
}
