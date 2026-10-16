import type { ChatSummary } from './types';

/**
 * A date field as a sort stamp, tolerating a raw string a cache left behind:
 * a `Date` gives its time; a string is parsed; anything unparsable or of
 * another type is the oldest possible time. A defence, so a cache gap never
 * throws here (T-1479).
 */
function sortStamp(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value !== 'string') {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The time a chat sorts by (T-1318): its newest message, else when it was
 * created or joined, else the oldest. A chat with messages is never moved by
 * its creation time, so a just-created group with no messages still leads the
 * list like Telegram.
 */
export function chatSortTime(chat: ChatSummary): number {
  return chat.lastMessage === undefined
    ? sortStamp(chat.createdAt)
    : sortStamp(chat.lastMessage.createdAt);
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

/**
 * T-1764: whether the user is in a topic. General is everyone's topic; any
 * other topic lists its people in `memberIds`. Older servers omit that list,
 * which reads as "not joined" — hiding is safer than leaking.
 */
export function isTopicJoined(
  topic: { isGeneral: boolean; memberIds?: readonly string[] },
  userId: string,
): boolean {
  return topic.isGeneral || (topic.memberIds ?? []).includes(userId);
}
