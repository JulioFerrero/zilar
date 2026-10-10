// Pure mappers from `/api/chats` entries to chat rows, shared by web and
// mobile (T-0924). No state, no Effect. Both apps bind to the one
// `summariesFor` here, so the row shape no longer drifts between them; a
// malformed topic row is dropped (never rendered), as each app did before.
import type { ChatSummary, TopicInfo } from '@zilar/chat-core';
import { Exit, Schema } from 'effect';
import {
  Topic as TopicSchema,
  type ChatEntry,
  type GroupBackground,
  type Topic,
} from '@zilar/api-contract';

/** A topic row the viewer may see; a malformed row decodes to `null` and is dropped. */
function topicOf(raw: unknown): Topic | null {
  const decoded = Schema.decodeUnknownExit(TopicSchema)(raw);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * The validated topics of one group entry: a malformed row is dropped, never
 * rendered. An entry without `topics` (older server) yields none, so the group
 * keeps its single legacy row.
 */
export function chatEntryTopics(entry: {
  readonly topics?: readonly unknown[] | undefined;
}): Topic[] {
  const rows = entry.topics;
  if (!Array.isArray(rows)) {
    return [];
  }
  const topics: Topic[] = [];
  for (const raw of rows) {
    const topic = topicOf(raw);
    if (topic !== null) {
      topics.push(topic);
    }
  }
  return topics;
}

function topicInfoOf(topic: Topic): TopicInfo {
  return {
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
  };
}

/** One DM, or one group without topics, maps to a single row. */
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
 * One topic becomes its own chat row (T-0111), keyed by the topic's room JID.
 * The General topic keeps the group's old chat id, so existing `/c/<jid>`
 * deep links open it. T-0124: a channel's General topic is its feed, so the
 * row carries the channel fields too.
 */
function summaryForTopic(
  groupTitle: string,
  groupId: string,
  topic: Topic,
  channel: {
    subscriberCount: number;
    description: string | null;
    role: 'owner' | 'admin' | 'member';
  } | null,
  visibility: 'private' | 'public',
  handle: string | null,
  avatarUrl: string | undefined,
  groupBackground: GroupBackground | undefined,
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
    topic: topicInfoOf(topic),
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
      entry.visibility ?? 'private',
      entry.handle ?? null,
      entry.avatarUrl,
      entry.background,
    ),
  );
}
