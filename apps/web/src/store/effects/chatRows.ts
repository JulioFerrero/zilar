// Pure mappers from `/api/chats` entries to chat rows. No state, no Effect.
import type { ChatSummary } from '@zilar/chat-core';
import { sortByRecency } from '@zilar/client-core/store';
import { chatEntryTopics, type ChatEntry, type GroupBackground, type Topic } from '@/lib/api';

export {
  advanceStatus,
  clearFailure,
  coreKind,
  moveChatToTop,
  rememberFinishedDraftMessage,
  sortByRecency,
  sortMessages,
} from '@zilar/client-core/store';

/**
 * Fresh server entries merged over what is already painted (the cached list
 * from the last visit): each chat keeps its preview and unread count, so rows
 * don't lose their second line or jump while XMPP catches up. A cached list
 * that belongs to another user is dropped.
 */
export function mergeWithPainted(
  painted: readonly ChatSummary[],
  fresh: ChatSummary[],
  paintedIsSameUser: boolean,
): ChatSummary[] {
  if (!paintedIsSameUser || painted.length === 0) {
    return fresh;
  }
  const byId = new Map(painted.map((chat) => [chat.id, chat]));
  return sortByRecency(
    fresh.map((chat) => {
      const previous = byId.get(chat.id);
      if (previous === undefined) {
        return chat;
      }
      const merged: ChatSummary = { ...chat, unread: previous.unread };
      if (previous.lastMessage !== undefined) {
        merged.lastMessage = previous.lastMessage;
      }
      return merged;
    }),
  );
}

function summaryFor(entry: ChatEntry): ChatSummary {
  const base = {
    id: entry.chatJid,
    title: entry.title,
    isAI: false,
    space: 'personal' as const,
    unread: 0,
    muted: false,
  };
  if (entry.kind === 'dm') {
    return {
      ...base,
      kind: 'dm',
      isAI: entry.isAi === true,
      ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
      online: false,
    };
  }
  // T-0124: channels ride the same rows as groups (their General topic is
  // the feed); the feed row carries `chatKind: 'channel'`, the subscriber
  // count and the blurb, plus the viewer's role (admins post, members read).
  // T-0164: every group row also carries `visibility` + `handle` (the web
  // paints a "Public" label from them).
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
 * One topic becomes its own chat row (T-0111), keyed by the topic's room JID.
 * The General topic keeps the group's old chat id, so existing `/c/<jid>`
 * deep links open it. A group without a `topics` field (older server) keeps
 * its single row from `summaryFor`. T-0124: a channel's General topic is its
 * feed, so the row carries the channel fields too.
 */
function summaryForTopic(
  groupTitle: string,
  groupId: string,
  topic: Topic,
  channel: {
    chatKind: 'channel';
    subscriberCount: number;
    description: string | null;
    role: 'owner' | 'admin' | 'member';
  } | null,
  visibility: 'private' | 'public' = 'private',
  handle: string | null = null,
  avatarUrl?: string | undefined,
  groupBackground?: GroupBackground,
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
    // T-0164: topic rows keep their group's visibility + handle, so the
    // header and the list paint the "Public" label on topics too.
    visibility,
    handle,
    // T-0165: topic rows keep their group's picture too.
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    // T-0466: topic rows keep their group's shared background too.
    ...(groupBackground === undefined ? {} : { groupBackground }),
    ...(channel === null
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

/**
 * Maps one `/api/chats` entry to its chat rows: DMs and AI chats map to one
 * row as before; a group with `topics` maps to one row per visible topic
 * (General keeps the group's old chat id); a group without the field keeps
 * its single legacy row.
 */
export function summariesFor(entry: ChatEntry): ChatSummary[] {
  if (entry.kind !== 'group') {
    return [summaryFor(entry)];
  }
  const topics = chatEntryTopics(entry).filter((topic) => !topic.archived);
  if (topics.length === 0) {
    return [summaryFor(entry)];
  }
  const chatKind = entry.chatKind ?? 'group';
  const channel =
    chatKind === 'channel'
      ? {
          chatKind: 'channel' as const,
          subscriberCount: entry.subscriberCount ?? entry.memberCount,
          description: entry.description ?? null,
          role: entry.role,
        }
      : null;
  return topics.map((topic) =>
    summaryForTopic(
      entry.title,
      entry.groupId,
      topic,
      channel,
      entry.visibility,
      entry.handle,
      entry.avatarUrl,
      entry.background,
    ),
  );
}
