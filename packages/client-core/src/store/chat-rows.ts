// Pure mappers from `/api/chats` entries to chat rows, shared by web and mobile. A malformed
// topic row is dropped. A preview's `id` stays the origin id (markers, quote jumps and dedupe
// key on it) while the server's `archiveId` rides `UiMessage.archiveId` as the read mark;
// `senderId` carries the sender name (display only).
import {
  applyChatPrefs,
  type ChatPrefRow,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import type { ChatEntry } from '@zilar/api-contract';
import { archiveMarkOf, createdAtOf, previewMessageOf, unreadOf } from './row-helpers';
import type { ServerRowFields } from './row-helpers';
import { orderChatRows } from './rows';
import { chatEntryTopics, summaryForTopic } from './topic-rows';

export type { ServerRowFields } from './row-helpers';
export { previewMessageOf, chatEntryTopics };

function previewAt(message: UiMessage | undefined): number {
  return message?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
}

/**
 * Merges one fresh server row over memory: a fresh `lastMessage` at least as new as
 * memory's wins, otherwise memory wins (messages arrived after the server answered). A row
 * without previews keeps the server `unread` only when memory has none either.
 */
export function mergeUnread(
  fresh: ChatSummary,
  existing: ChatSummary | undefined,
  activeChatId: string | null | undefined,
): ChatSummary {
  if (existing === undefined) {
    return activeChatId !== undefined && activeChatId !== null && fresh.id === activeChatId
      ? { ...fresh, unread: 0 }
      : fresh;
  }
  const freshAt = previewAt(fresh.lastMessage);
  const memoryAt = previewAt(existing.lastMessage);
  const serverWins =
    fresh.lastMessage !== undefined ? freshAt >= memoryAt : existing.lastMessage === undefined;
  const merged: ChatSummary = serverWins
    ? { ...fresh }
    : {
        ...fresh,
        unread: existing.unread,
        ...(existing.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
      };
  if (activeChatId !== undefined && activeChatId !== null && merged.id === activeChatId) {
    return { ...merged, unread: 0 };
  }
  return merged;
}

/**
 * The whole chat list after a refresh: fresh rows merged over memory, then pinned, muted
 * and archived by the saved prefs. A known row keeps `online`, `lastSeenAt` and
 * `onlineCount` from memory because XMPP sends presence and the list answer does not.
 */
export function mergeChatRows(
  previous: readonly ChatSummary[],
  freshRows: readonly ChatSummary[],
  activeChatId: string | null | undefined,
  prefs: readonly ChatPrefRow[],
  nowMs: number,
): ChatSummary[] {
  const known = new Map(previous.map((chat) => [chat.id, chat]));
  const fresh = freshRows.filter((row) => !known.has(row.id));
  const kept = freshRows
    .filter((row) => known.has(row.id))
    .map((row) => {
      const existing = known.get(row.id);
      if (existing === undefined) {
        return row;
      }
      const merged = mergeUnread(row, existing, activeChatId);
      return {
        ...merged,
        ...(existing.online === undefined ? {} : { online: existing.online }),
        ...(existing.lastSeenAt === undefined ? {} : { lastSeenAt: existing.lastSeenAt }),
        ...(existing.onlineCount === undefined ? {} : { onlineCount: existing.onlineCount }),
      };
    });
  return applyChatPrefs(orderChatRows(fresh, kept), prefs, nowMs);
}

function summaryFor(entry: ChatEntry, server: ServerRowFields | undefined): ChatSummary {
  const unread = server === undefined ? 0 : unreadOf(server.unread);
  const lastMessage =
    server?.lastMessage === undefined
      ? undefined
      : previewMessageOf(entry.chatJid, server.lastMessage);
  const deliveredUntil = server === undefined ? undefined : archiveMarkOf(server.deliveredUntil);
  const readUntil = server === undefined ? undefined : archiveMarkOf(server.readUntil);
  const createdAt = server === undefined ? undefined : createdAtOf(server.createdAt);
  const base = {
    id: entry.chatJid,
    title: entry.title,
    isAI: false,
    space: 'personal' as const,
    unread,
    muted: false,
    ...(lastMessage === undefined ? {} : { lastMessage }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(deliveredUntil === undefined ? {} : { deliveredUntil }),
  };
  if (entry.kind === 'dm') {
    return {
      ...base,
      kind: 'dm',
      isAI: entry.isAi === true,
      ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
      ...(readUntil === undefined ? {} : { readUntil }),
      online: false,
    };
  }
  // Channels ride group rows (their General topic is the feed): `chatKind: 'channel'` with
  // the subscriber count, blurb and role; every group row also carries `visibility` and `handle`.
  const chatKind = entry.chatKind ?? 'group';
  return {
    ...base,
    kind: 'group',
    memberCount: entry.memberCount,
    onlineCount: 0,
    visibility: entry.visibility ?? 'private',
    handle: entry.handle ?? null,
    ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
    ...(entry.background === undefined ? {} : { groupBackground: entry.background }),
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

/** Maps one `/api/chats` entry to its chat rows; archived topics never produce a row. */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [summaryFor(entry, entry)];
  }
  // A channel's only topic is its General feed, which is the row itself, so a channel never
  // expands into topic rows — not even from an older server or a cached answer.
  if ((entry.chatKind ?? 'group') === 'channel') {
    return [summaryFor(entry, entry)];
  }
  const topics = chatEntryTopics(entry).filter((topic) => !topic.archived);
  if (topics.length === 0) {
    return [summaryFor(entry, entry)];
  }
  const chatKind = entry.chatKind ?? 'group';
  const channel =
    chatKind === 'channel'
      ? {
          subscriberCount: entry.subscriberCount ?? entry.memberCount,
          description: entry.description ?? null,
          role: entry.role,
        }
      : null;
  // The General row is the group's own row; every other topic keeps its raw topic object
  // so extra server fields still read.
  const topicsByJid = new Map<string, ServerRowFields>();
  if (Array.isArray(entry.topics)) {
    for (const raw of entry.topics) {
      if (typeof raw === 'object' && raw !== null) {
        const chatJid = (raw as { chatJid?: unknown }).chatJid;
        if (typeof chatJid === 'string') {
          topicsByJid.set(chatJid, raw);
        }
      }
    }
  }
  return topics.map((topic) =>
    summaryForTopic(
      entry.title,
      entry.groupId,
      topic,
      channel,
      entry.visibility ?? 'private',
      entry.handle ?? null,
      entry.avatarUrl,
      entry.background,
      topic.isGeneral ? entry : topicsByJid.get(topic.chatJid),
    ),
  );
}
