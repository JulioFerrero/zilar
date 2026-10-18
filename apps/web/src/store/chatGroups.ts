import type { ChatSummary } from '@zilar/chat-core';
import { chatSortTime, folderUnreadTotal, isUnjoinedTopic, sortTopics } from '@zilar/chat-core';
import type { ChatStoreState } from './store';
import { activeFolderOf, matchesFolder } from './selectors';

/** One sidebar group: the group's title plus its topic rows; DMs and AI chats are
 * singleton groups with a stable key. */
export interface ChatGroup {
  key: string;
  title: string;
  groupId: string | undefined;
  avatarUrl?: string | undefined;
  topics: ChatSummary[];
}

function groupTitleOf(chat: ChatSummary): string {
  return chat.groupTitle ?? chat.title;
}

/** Folds the flat chat list into sidebar groups: topics nest under their group, DMs and AI
 * chats stand alone, and per-user archived chats are hidden here. Pinned first (via the
 * General room's pref, newer pins first), then newest activity, ties by title; inside a
 * group, pinned topics float above the rest. */
export function groupChats(state: ChatStoreState): ChatGroup[] {
  const query = state.search.trim().toLowerCase();
  const byGroup = new Map<string, ChatSummary[]>();
  const singles: ChatSummary[] = [];
  for (const chat of state.chats) {
    // Manager-archived topics never reach the client; per-user archived topics stay in their
    // group so its Archived toggle shows them, while archived DMs and AIs drop to the bottom list.
    if (chat.topic === undefined && chat.archived === true) {
      continue;
    }
    // An unjoined topic lives under the group's Other topics with Join, not in the chat list.
    if (isUnjoinedTopic(chat.topic, state.currentUserId)) {
      continue;
    }
    if (!matchesFolder(chat, activeFolderOf(state))) {
      continue;
    }
    if (chat.topic !== undefined && chat.groupId !== undefined) {
      const list = byGroup.get(chat.groupId) ?? [];
      list.push(chat);
      byGroup.set(chat.groupId, list);
    } else {
      if (query.length > 0 && !chat.title.toLowerCase().includes(query)) {
        continue;
      }
      singles.push(chat);
    }
  }
  const groups: ChatGroup[] = [];
  for (const [groupId, topics] of byGroup) {
    const groupMatches = query.length > 0 && groupTitleOf(topics[0]!).toLowerCase().includes(query);
    const matching =
      query.length === 0 || groupMatches
        ? topics
        : topics.filter((topic) => topic.title.toLowerCase().includes(query));
    if (matching.length === 0) {
      continue;
    }
    const title = groupTitleOf(matching[0] ?? topics[0]!);
    groups.push({
      key: `group:${groupId}`,
      title,
      groupId,
      // Every topic row carries the group's picture, so the first one paints the header.
      ...(matching[0]?.avatarUrl === undefined ? {} : { avatarUrl: matching[0].avatarUrl }),
      topics: sortTopics(matching),
    });
  }
  for (const chat of singles) {
    groups.push({ key: `chat:${chat.id}`, title: chat.title, groupId: undefined, topics: [chat] });
  }
  return sortGroups(groups);
}

// A group's pin stamp comes from the General topic (the pref lives on the General room JID).
function groupPinTime(group: ChatGroup): number {
  const general = group.topics.find((topic) => topic.topic?.isGeneral === true);
  const row = general ?? group.topics[0];
  return row?.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

// A group's recency is its newest topic's; a singleton group's is its own row's.
function groupSortTime(group: ChatGroup): number {
  return Math.max(Number.NEGATIVE_INFINITY, ...group.topics.map((topic) => chatSortTime(topic)));
}

// Newer first; equal stamps compare equal, including two -Infinity stamps (subtracting
// infinities would give NaN and freeze the sort).
function compareNewestFirst(left: number, right: number): number {
  if (left === right) {
    return 0;
  }
  return right > left ? 1 : -1;
}

function sortGroups(groups: ChatGroup[]): ChatGroup[] {
  return [...groups].sort((left, right) => {
    const pin = compareNewestFirst(groupPinTime(left), groupPinTime(right));
    if (pin !== 0) {
      return pin;
    }
    const time = compareNewestFirst(groupSortTime(left), groupSortTime(right));
    return time !== 0 ? time : left.title.localeCompare(right.title);
  });
}

export function folderUnread(state: ChatStoreState, folderId: string): number {
  if (folderId === 'all') {
    return folderUnreadTotal('all', state.chats);
  }
  const folder = state.folders.find((entry) => entry.id === folderId);
  if (folder === undefined) {
    return 0;
  }
  return folderUnreadTotal(folder, state.chats);
}
