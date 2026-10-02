import type { ChatSummary } from '@zilar/chat-core';

import { archivedChats, sortChatPinnedFirst, unarchivedChats } from './chat-prefs';
import { filterChats } from './filter';
import { groupRowFor, groupTopicChats } from './topics';
import type { ChatFolder } from './types';

/**
 * The chat list's row model (T-0135): the same composition the chat list
 * screen renders, as a pure function with Vitest coverage. Pinned
 * chats/topics float first (a group counts as pinned when any of its
 * topics is pinned), archived chats leave the main list for the Archived
 * entry, groups with topics collapse to one row per group.
 */

export type ChatListRow = { kind: 'chat'; chat: ChatSummary } | { kind: 'group'; groupId: string };

export interface ChatListModel {
  rows: ChatListRow[];
  /** The archived chats shown under the Archived entry. */
  archived: ChatSummary[];
}

export function chatListModel(
  chats: readonly ChatSummary[],
  options: { folder: ChatFolder; search: string },
): ChatListModel {
  const filtered = filterChats(chats, options);
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
      return row.chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    }
    const topics = byGroup.get(row.groupId) ?? [];
    return Math.max(
      Number.NEGATIVE_INFINITY,
      ...topics.map((chat) => chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY),
    );
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
    return timeOf(right) - timeOf(left);
  });
  return { rows, archived: archivedChats(filtered) };
}
