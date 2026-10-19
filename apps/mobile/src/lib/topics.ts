import { sortTopics, type ChatSummary } from '@zilar/chat-core';

import type { ChatFolder } from './types';

/**
 * Each visible topic is its own chat keyed by its room JID, General keeps the group's old chat id, and an older server without `topics` keeps one row per group.
 */

export { sortTopics };

export function topicsOfGroup(chats: readonly ChatSummary[], groupId: string): ChatSummary[] {
  return sortTopics(chats.filter((chat) => chat.groupId === groupId && chat.topic !== undefined));
}

/**
 * The active list hides manager-archived and per-user archived topics; both share one Archived section, never two.
 */
export function splitGroupTopics(topics: readonly ChatSummary[]): {
  active: ChatSummary[];
  archived: ChatSummary[];
} {
  const active: ChatSummary[] = [];
  const archived: ChatSummary[] = [];
  for (const topic of topics) {
    if (topic.topic?.archived === true || topic.archived === true) {
      archived.push(topic);
    } else {
      active.push(topic);
    }
  }
  return { active, archived };
}

export interface GroupRow {
  groupId: string;
  title: string;
  topicCount: number;
  unread: number;
  newestAt: Date | undefined;
  preview: { prefix: string; senderName: string; text: string } | undefined;
  muted: boolean;
  memberCount: number | undefined;
  onlineCount: number | undefined;
  // Set when the group's rows are a channel feed: the list paints "N subscribers" instead of "N topics/members".
  chatKind?: 'group' | 'channel';
  subscriberCount?: number;
  description?: string | null;
  topics: ChatSummary[];
}

/**
 * Legacy group rows and DMs pass through untouched; callers keep them as their own single-item rows.
 */
export function groupTopicChats(chats: readonly ChatSummary[]): Map<string, ChatSummary[]> {
  const groups = new Map<string, ChatSummary[]>();
  for (const chat of chats) {
    if (chat.topic === undefined || chat.groupId === undefined) {
      continue;
    }
    const list = groups.get(chat.groupId) ?? [];
    list.push(chat);
    groups.set(chat.groupId, list);
  }
  return groups;
}

export function groupRowFor(groupId: string, topics: readonly ChatSummary[]): GroupRow | undefined {
  const sorted = sortTopics(topics);
  const general = sorted.find((chat) => chat.topic?.isGeneral === true);
  const first = sorted[0];
  if (first === undefined) {
    return undefined;
  }
  const title = general?.groupTitle ?? first.groupTitle ?? first.title;
  const newest = sorted.reduce<ChatSummary | undefined>((best, chat) => {
    const time = chat.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const bestTime = best?.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    return time > bestTime ? chat : best;
  }, undefined);
  const last = newest?.lastMessage;
  // A channel's topics are its feed: the row reads "N subscribers" with the blurb, never the topic count.
  const channelRow = sorted.find((chat) => chat.chatKind === 'channel');
  return {
    groupId,
    title,
    topicCount: sorted.length,
    unread: sorted.reduce((total, chat) => total + chat.unread, 0),
    newestAt: last?.createdAt,
    preview:
      last === undefined
        ? undefined
        : {
            prefix: last.senderName,
            senderName: last.senderName,
            text: last.text ?? '',
          },
    muted: sorted.every((chat) => chat.muted),
    memberCount: general?.memberCount ?? first.memberCount,
    onlineCount: general?.onlineCount ?? first.onlineCount,
    ...(channelRow === undefined
      ? {}
      : {
          chatKind: 'channel' as const,
          subscriberCount: channelRow.subscriberCount ?? channelRow.memberCount,
          description: channelRow.description ?? null,
        }),
    topics: sorted,
  };
}

export function topicInFolder(chat: ChatSummary, folder: ChatFolder): boolean {
  switch (folder) {
    case 'all':
      return true;
    case 'personal':
      return chat.space === 'personal' && !chat.isAI;
    case 'ai':
      return chat.isAI;
    case 'work':
      return chat.space === 'work';
  }
}

export { httpsTopicUrl, topicLinkText } from '@zilar/chat-core';
export { mayArchiveTopic, mayCreateTopic, mayManageTopic } from '@zilar/chat-core';
export type { GroupMembership, GroupRole, TopicPermissionsInput } from '@zilar/chat-core';

export function topicsHeaderSubtitle(options: { memberCount: number; topicCount: number }): string {
  const members = options.memberCount === 1 ? '1 member' : `${options.memberCount} members`;
  return `${members}, ${topicCountLabel(options.topicCount)}`;
}

export function topicCountLabel(topicCount: number): string {
  return topicCount === 1 ? '1 topic' : `${topicCount} topics`;
}

/**
 * Never show a private topic's name to someone who cannot see it: the caller uses this fixed text when the open topic disappears.
 */
export const TOPIC_GONE_NOTICE = 'This topic is no longer available.';
