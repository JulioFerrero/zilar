// Pure mappers from `/api/chats` entries to chat rows, shared by web and
// mobile (T-0924). No state, no Effect. Both apps bind to the one
// `summariesFor` here, so the row shape no longer drifts between them; a
// malformed topic row is dropped (never rendered), as each app did before.
//
// T-1207: the entry's `unread` (default 0) and `lastMessage` preview ride
// every row (DMs, group General rows and topic rows, whose topic objects
// carry the same two fields). The preview becomes a display-only `UiMessage`
// (`createdAt` from `at`, `status: 'sent'`); its `id` stays the origin id
// (markers, quote jumps and dedupe key on it) while the server's `archiveId`
// rides `UiMessage.archiveId` as the read mark; the server names only a display
// name, never a sender id, so `senderId` carries the sender name (display
// only: the row preview reads `senderName`, never `senderId`). The merge rule
// (`mergeUnread`) lives here too, so no barrel change is needed.
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { ChatEntry } from '@zilar/api-contract';
import { archiveMarkOf, createdAtOf, previewMessageOf, unreadOf } from './row-helpers';
import type { ServerRowFields } from './row-helpers';
import { chatEntryTopics, summaryForTopic } from './topic-rows';

export type { ServerRowFields } from './row-helpers';
export { previewMessageOf, chatEntryTopics };

function previewAt(message: UiMessage | undefined): number {
  return message?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
}

/**
 * Merges one fresh server row over the in-memory row: when the fresh
 * `lastMessage` is at least as new as memory's, the server wins (a read on
 * another device moves the mark but sends no message, so the server preview
 * is as fresh as memory); otherwise memory wins (messages arrived after the
 * server answered). A row without either preview keeps the server `unread`
 * only when memory has no preview either; a memory preview with no server
 * preview means messages arrived after the server answered, so memory wins
 * whole. The open chat always ends at 0 when its id is known.
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

/** One DM, or one group without topics, maps to a single row. */
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
  // T-0124: channels ride the same rows as groups (their General topic is the
  // feed); the feed row carries `chatKind: 'channel'`, the subscriber count,
  // the blurb and the viewer's role. T-0164: every group row also carries
  // `visibility` + `handle` (the web paints a "Public" label from them).
  const chatKind = entry.chatKind ?? 'group';
  return {
    ...base,
    kind: 'group',
    memberCount: entry.memberCount,
    onlineCount: 0,
    visibility: entry.visibility ?? 'private',
    handle: entry.handle ?? null,
    // T-0165: the group's picture rides the entry, like DMs carry theirs.
    ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
    // T-0466: the group's shared background rides the entry too.
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

/**
 * Maps one `/api/chats` entry to its chat rows: DMs and AI chats map to one
 * row as before; a group with `topics` maps to one row per visible topic
 * (General keeps the group's old chat id); a group without the field keeps
 * its single legacy row. Archived topics never produce a row.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [summaryFor(entry, entry)];
  }
  // T-1355: a channel's only topic is its General feed, and that feed is the
  // row itself, so a channel never expands into topic rows — not from an older
  // server that still sends the General topic, and not from a cached answer.
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
  // The General row is the group's own row: it carries the entry's fields.
  // Every other topic carries its own topic-object fields; the raw objects
  // are kept (not the decoded `Topic`s) so extra server fields still read.
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
