import type { ChatSummary } from '@zilar/chat-core';
import { chatSortTime, folderUnreadTotal, sortTopics } from '@zilar/chat-core';
import type { ChatStoreState } from './store';
import { activeFolderOf, matchesFolder } from './selectors';

/**
 * One sidebar group (T-0111): the group's title plus its topic rows. DMs and
 * AI chats are singleton groups with a stable key.
 */
export interface ChatGroup {
  key: string;
  title: string;
  /** The group's id for avatar + collapse state; undefined for DMs/AIs. */
  groupId: string | undefined;
  /** T-0165: the group's picture, from its first topic row. */
  avatarUrl?: string | undefined;
  topics: ChatSummary[];
}

function groupTitleOf(chat: ChatSummary): string {
  return chat.groupTitle ?? chat.title;
}

/**
 * Folds the flat chat list into sidebar groups: every topic of a group nests
 * under its group header; DMs and AI chats stand alone. Per-user archived
 * chats are hidden here (they live in the Archived section). Groups and
 * singleton chats share one list sorted pinned first (via the General room's
 * pref, newer pins first), then newest activity first, ties by title; inside a
 * group, pinned topics float above the rest with General first among the
 * unpinned. Search keeps a group header when any of its topics matches by
 * name, or when the group's own name contains the query (then it shows all its
 * topics). Folders treat a topic like its group (a topic
 * matches when its own row does).
 */
export function groupChats(state: ChatStoreState): ChatGroup[] {
  const query = state.search.trim().toLowerCase();
  const byGroup = new Map<string, ChatSummary[]>();
  const singles: ChatSummary[] = [];
  for (const chat of state.chats) {
    // Manager-archived topics never reach the client (the server excludes
    // them); per-user archived topics stay in their group so the group's own
    // Archived toggle shows them. Per-user archived DMs/AIs live in the
    // bottom Archived list instead.
    if (chat.topic === undefined && chat.archived === true) {
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
      // T-0165: every topic row carries the group's picture, so the first
      // one paints the header.
      ...(matching[0]?.avatarUrl === undefined ? {} : { avatarUrl: matching[0].avatarUrl }),
      topics: sortTopics(matching),
    });
  }
  for (const chat of singles) {
    groups.push({ key: `chat:${chat.id}`, title: chat.title, groupId: undefined, topics: [chat] });
  }
  return sortGroups(groups);
}

// A group's pin stamp: the General topic's (the pref lives on the General
// room JID). A singleton group's is its own row's.
function groupPinTime(group: ChatGroup): number {
  const general = group.topics.find((topic) => topic.topic?.isGeneral === true);
  const row = general ?? group.topics[0];
  return row?.pinnedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

// A group's recency: the newest activity among its topics. A singleton group
// has one topic, so this is its own row's time.
function groupSortTime(group: ChatGroup): number {
  return Math.max(Number.NEGATIVE_INFINITY, ...group.topics.map((topic) => chatSortTime(topic)));
}

// Newer first; equal stamps compare equal, including two -Infinity stamps
// (subtracting infinities would give NaN and freeze the sort).
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
