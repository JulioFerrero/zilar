// T-1547: the topic half of `chat-rows.ts`, split out so both stay under the
// line limit. It maps one group's validated topics to their chat rows and takes
// its row fields and shared helpers from `row-helpers.ts`; `chat-rows.ts`
// imports this file, never the other way.
import type { ChatSummary, TopicAiActivity, TopicAiState, TopicInfo } from '@zilar/chat-core';
import { Exit, Schema } from 'effect';
import { Topic as TopicSchema, type GroupBackground, type Topic } from '@zilar/api-contract';
import {
  archiveMarkOf,
  createdAtOf,
  previewMessageOf,
  unreadOf,
  type ServerRowFields,
} from './row-helpers';

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
    doneAt: topic.doneAt ?? null,
    owner: topic.owner,
    linkUrl: topic.linkUrl,
    linkLabel: topic.linkLabel,
    activity: topicActivityOf(topic),
  };
}

// T-1514: the AI activity of one topic. A missing field (an older server) or an
// entry with an unknown state (a newer one) is left out; the known three keep,
// in the server's order.
function topicActivityOf(topic: Topic): TopicAiActivity[] {
  const rows: TopicAiActivity[] = [];
  for (const entry of topic.activity ?? []) {
    if (isTopicAiState(entry.state)) {
      rows.push({
        aiId: entry.aiId,
        name: entry.name,
        ...(entry.jid === undefined ? {} : { jid: entry.jid }),
        ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
        ...(entry.questionId === undefined ? {} : { questionId: entry.questionId }),
        state: entry.state,
      });
    }
  }
  return rows;
}

function isTopicAiState(state: string): state is TopicAiState {
  return state === 'working' || state === 'waiting' || state === 'done';
}

/**
 * One topic becomes its own chat row (T-0111), keyed by the topic's room JID.
 * The General topic keeps the group's old chat id, so existing `/c/<jid>`
 * deep links open it. T-0124: a channel's General topic is its feed, so the
 * row carries the channel fields too.
 */
export function summaryForTopic(
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
  server: ServerRowFields | undefined,
): ChatSummary {
  const unread = server === undefined ? 0 : unreadOf(server.unread);
  const lastMessage =
    server?.lastMessage === undefined
      ? undefined
      : previewMessageOf(topic.chatJid, server.lastMessage);
  const deliveredUntil = server === undefined ? undefined : archiveMarkOf(server.deliveredUntil);
  const createdAt = server === undefined ? undefined : createdAtOf(server.createdAt);
  return {
    id: topic.chatJid,
    title: topic.name,
    kind: 'group',
    isAI: false,
    space: 'personal',
    unread,
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
    ...(lastMessage === undefined ? {} : { lastMessage }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(deliveredUntil === undefined ? {} : { deliveredUntil }),
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
