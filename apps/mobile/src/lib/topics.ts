import type { ChatSummary, TopicInfo, TopicKind, TopicStatus } from '@galena/chat-core';

import { chatEntryTopics, type Topic } from './topics-api';
import type { ChatEntry } from './chat-api';
import type { ChatFolder } from './types';

/**
 * Plain topic helpers (T-0112), the mobile twin of the web store mapping and
 * `TopicRow` ordering: each visible topic is its own chat keyed by its room
 * JID, General keeps the group's old chat id, and an older server without
 * `topics` keeps one row per group. Components stay thin; everything here is
 * a pure function with Vitest coverage.
 */

/** One topic row from the wire, keyed by its room JID (General keeps the id). */
export function summaryForTopic(
  groupTitle: string,
  groupId: string,
  topic: Topic,
  channel?: { subscriberCount: number; description: string | null; role: GroupRole },
): ChatSummary {
  return {
    id: topic.chatJid,
    title: topic.name,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    memberCount: topic.memberCount,
    onlineCount: 0,
    // T-0144: a channel's General topic is its feed, so the row carries the
    // channel fields (chatKind, subscriberCount, description, myRole) like
    // web's `summaryForTopic`.
    ...(channel === undefined
      ? {}
      : {
          chatKind: 'channel' as const,
          subscriberCount: channel.subscriberCount,
          description: channel.description,
          myRole: channel.role,
        }),
    groupId,
    groupTitle,
    topic: {
      id: topic.id,
      glyph: topic.glyph,
      kind: topic.kind,
      status: topic.status,
      visibility: topic.visibility,
      isGeneral: topic.isGeneral,
      archived: false,
      owner: topic.owner,
      linkUrl: topic.linkUrl,
      linkLabel: topic.linkLabel,
    },
  };
}

function baseSummaryForGroup(entry: Extract<ChatEntry, { kind: 'group' }>): ChatSummary {
  const chatKind = entry.chatKind ?? 'group';
  return {
    id: entry.chatJid,
    title: entry.title,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread: 0,
    muted: false,
    memberCount: entry.memberCount,
    onlineCount: 0,
    // T-0144: a legacy channel row (older server, no `topics`) still reads as
    // a channel — the subscriber count, the blurb and the viewer's role ride
    // the row, like web's `summaryFor`.
    ...(chatKind === 'channel'
      ? {
          chatKind: 'channel' as const,
          subscriberCount: entry.subscriberCount ?? entry.memberCount,
          description: entry.description ?? null,
          myRole: entry.role,
        }
      : {}),
  };
}

/**
 * One `/api/chats` entry to its chat rows: a group with `topics` maps to one
 * row per non-archived topic; a group without the field keeps its single
 * legacy row. Archived topics never produce a row.
 */
export function summariesForTopicsEntry(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [];
  }
  // T-0139: the entry's rows come from `parseChat`'s `parseTopic`
  // validation, but untyped callers (older tests) may pass raw wire rows:
  // re-validate every row with the same shape so a malformed one is
  // dropped, never rendered.
  const raw = entry.topics !== undefined ? entry.topics : [];
  const topics = chatEntryTopics({ topics: raw }).filter((topic) => !topic.archived);
  if (topics.length === 0) {
    return [baseSummaryForGroup(entry)];
  }
  // T-0144: a channel's General topic is its feed, so every row carries the
  // channel fields (the feed paints the channel bar; the role gates the
  // composer), like web's `summariesFor`.
  const chatKind = entry.chatKind ?? 'group';
  const channel =
    chatKind === 'channel'
      ? {
          subscriberCount: entry.subscriberCount ?? entry.memberCount,
          description: entry.description ?? null,
          role: entry.role,
        }
      : undefined;
  return topics.map((topic) => summaryForTopic(entry.title, entry.groupId, topic, channel));
}

/** True when the chat is a group topic (a group chat with a task strip). */
export function isTopicChat(chat: ChatSummary): boolean {
  return chat.topic !== undefined;
}

/** True when the chat is a legacy group row (no `topics` from an old server). */
export function isLegacyGroupChat(chat: ChatSummary): boolean {
  return chat.kind === 'group' && chat.topic === undefined;
}

/** Every topic of one group, General first, then by newest message. */
export function sortTopics(chats: readonly ChatSummary[]): ChatSummary[] {
  return [...chats].sort((left, right) => {
    const leftGeneral = left.topic?.isGeneral === true;
    const rightGeneral = right.topic?.isGeneral === true;
    if (leftGeneral !== rightGeneral) {
      return leftGeneral ? -1 : 1;
    }
    const leftTime = left.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.title.localeCompare(right.title);
  });
}

/** The topics of one group from the full chat list (legacy rows excluded). */
export function topicsOfGroup(chats: readonly ChatSummary[], groupId: string): ChatSummary[] {
  return sortTopics(chats.filter((chat) => chat.groupId === groupId && chat.topic !== undefined));
}

/**
 * Splits one group's topics like the web group row (T-0113): the active
 * list hides manager-archived topics (`topic.archived`) and per-user
 * archived ones (`archived`); both share one Archived section, never two.
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

/** One row per group shown on the chat list, aggregated from its topics. */
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
  // T-0144: set when the group's rows are a channel feed — the list paints
  // the megaphone marker and "N subscribers" instead of "N topics/members".
  chatKind?: 'group' | 'channel';
  subscriberCount?: number;
  description?: string | null;
  topics: ChatSummary[];
}

/**
 * Groups topic chats by `groupId`; legacy group rows and DMs pass through
 * untouched (they are not groups of topics). Callers keep the legacy rows as
 * their own single-item group rows.
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

/** Aggregates one group's topics into its chat-list row. */
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
  // T-0144: a channel's topics are its feed (the General row carries
  // `chatKind: 'channel'`): the row reads "N subscribers" with the blurb,
  // never the topic count.
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

/** Folders treat a topic like its group: topics keep the group's space. */
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

const TYPE_LABEL: Record<TopicKind, string> = {
  chat: 'TOPIC',
  task: 'TASK',
  bug: 'BUG',
  ui: 'UI',
  routine: 'ROUTINE',
};

/** The type chip of the task strip: TOPIC for `chat`, GENERAL for General. */
export function topicTypeLabel(topic: TopicInfo | undefined): string {
  if (topic === undefined) {
    return 'TOPIC';
  }
  if (topic.isGeneral) {
    return 'GENERAL';
  }
  return TYPE_LABEL[topic.kind] ?? 'TOPIC';
}

const STATUS_LABEL: Record<TopicStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  in_review: 'In review',
  blocked: 'Blocked',
  done: 'Done',
};

/** The status chip label, always paired with its dot, never color alone. */
export function topicStatusLabel(status: TopicStatus): string {
  return STATUS_LABEL[status] ?? 'Open';
}

/** The task-strip owner label. */
export function topicOwnerLabel(topic: TopicInfo | undefined): string {
  const owner = topic?.owner;
  if (owner === null || owner === undefined) {
    return 'No owner';
  }
  return `Owner: ${owner.name}`;
}

/** Only `https:` URLs render as links; anything else is plain text or hidden. */
export function httpsTopicUrl(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) {
    return undefined;
  }
  const trimmed = url.trim();
  if (trimmed === '') {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The link chip text: the label, else the hostname, else "Add link". */
export function topicLinkText(topic: TopicInfo | undefined): string {
  if (topic?.linkLabel !== null && topic?.linkLabel !== undefined && topic.linkLabel !== '') {
    return topic.linkLabel;
  }
  const href = httpsTopicUrl(topic?.linkUrl);
  if (href !== undefined) {
    try {
      return new URL(href).hostname;
    } catch {
      return href;
    }
  }
  return 'Add link';
}

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMembership {
  userId: string;
  name: string;
  role: GroupRole;
}

export interface TopicPermissionsInput {
  members: readonly GroupMembership[];
  meUserId: string;
  membersCanCreateTopics: boolean;
}

function myRole(input: TopicPermissionsInput): GroupRole | undefined {
  return input.members.find((member) => member.userId === input.meUserId)?.role;
}

function isManager(role: GroupRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The viewer may create: owner/admin always, members when the switch is on. */
export function mayCreateTopic(input: TopicPermissionsInput): boolean {
  const role = myRole(input);
  if (role === undefined) {
    return false;
  }
  if (isManager(role)) {
    return true;
  }
  return input.membersCanCreateTopics;
}

/** The viewer may manage (rename, members, visibility, archive): a manager. */
export function mayManageTopic(input: TopicPermissionsInput): boolean {
  return isManager(myRole(input));
}

/** The viewer may archive: a manager, and never the General topic. */
export function mayArchiveTopic(
  input: TopicPermissionsInput,
  topic: TopicInfo | undefined,
): boolean {
  if (topic?.isGeneral === true) {
    return false;
  }
  return mayManageTopic(input);
}

/** "8 members, 2 AIs, 6 topics" for the topics screen header. */
export function topicsHeaderSubtitle(options: {
  memberCount: number;
  aiCount: number;
  topicCount: number;
}): string {
  const members = options.memberCount === 1 ? '1 member' : `${options.memberCount} members`;
  const ais = options.aiCount === 1 ? '1 AI' : `${options.aiCount} AIs`;
  return `${members}, ${ais}, ${topicCountLabel(options.topicCount)}`;
}

/** "N topics" for a group row, singular for one (T-0112 should-fix). */
export function topicCountLabel(topicCount: number): string {
  return topicCount === 1 ? '1 topic' : `${topicCount} topics`;
}

/**
 * Never show a private topic's name to someone who cannot see it: notices and
 * titles use this fixed text when the open topic disappears. The caller must
 * only call it for a chat that was a topic; the name itself is never used.
 */
export const TOPIC_GONE_NOTICE = 'This topic is no longer available.';
