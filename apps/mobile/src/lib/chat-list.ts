import { chatSortTime, isUnjoinedTopic, type ChatFolder, type ChatSummary } from '@zilar/chat-core';

import { archivedChats, sortChatPinnedFirst, unarchivedChats } from './chat-prefs';
import { filterChats } from './filter';
import { groupRowFor, groupTopicChats } from './topics';

/**
 * Pinned chats/topics float first (a group is pinned when any topic is), archived chats move to the Archived entry, and a group with topics collapses to one row.
 */

export type ChatListRow = { kind: 'chat'; chat: ChatSummary } | { kind: 'group'; groupId: string };

export const CHAT_SEARCH_LIMIT = 5;

export function chatSearchMatches(rows: readonly ChatListRow[]): ChatListRow[] {
  return rows.slice(0, CHAT_SEARCH_LIMIT);
}

export interface ChatListModel {
  rows: ChatListRow[];
  archived: ChatSummary[];
}

export function chatListModel(
  chats: readonly ChatSummary[],
  options: { folder: ChatFolder | undefined; search: string; myUserId?: string },
): ChatListModel {
  const joined = chats.filter((chat) => !isUnjoinedTopic(chat.topic, options.myUserId ?? ''));
  const filtered = filterChats(joined, options);
  const listed = unarchivedChats(filtered);
  const pinned = sortChatPinnedFirst(listed);
  const byGroup = groupTopicChats(pinned);
  const topicIds = new Set([...byGroup.values()].flat().map((chat) => chat.id));
  const rows: ChatListRow[] = pinned
    .filter((chat) => !topicIds.has(chat.id))
    .map((chat) => ({ kind: 'chat', chat }));
  for (const [groupId, topics] of byGroup) {
    if (groupRowFor(groupId, topics) !== undefined) {
      rows.push({ kind: 'group', groupId });
    }
  }
  const pinnedIds = new Set(
    pinned.filter((chat) => chat.pinnedAt !== undefined).map((chat) => chat.id),
  );
  const pinnedGroupIds = new Set(
    [...byGroup.entries()]
      .filter(([, topics]) => topics.some((topic) => pinnedIds.has(topic.id)))
      .map(([groupId]) => groupId),
  );
  const timeOf = (row: ChatListRow): number => {
    if (row.kind === 'chat') {
      return chatSortTime(row.chat);
    }
    const topics = byGroup.get(row.groupId) ?? [];
    return Math.max(Number.NEGATIVE_INFINITY, ...topics.map((chat) => chatSortTime(chat)));
  };
  rows.sort((left, right) => {
    const leftPinned =
      (left.kind === 'chat' && pinnedIds.has(left.chat.id)) ||
      (left.kind === 'group' && pinnedGroupIds.has(left.groupId));
    const rightPinned =
      (right.kind === 'chat' && pinnedIds.has(right.chat.id)) ||
      (right.kind === 'group' && pinnedGroupIds.has(right.groupId));
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    // Never subtract: two rows with neither a message nor a creation time sort at `-Infinity`, and `-Infinity - -Infinity` is `NaN`, which makes the comparator inconsistent (Hermes then misplaces the other rows).
    const leftTime = timeOf(left);
    const rightTime = timeOf(right);
    if (leftTime === rightTime) {
      return 0;
    }
    return rightTime > leftTime ? 1 : -1;
  });
  return { rows, archived: archivedChats(filtered) };
}
