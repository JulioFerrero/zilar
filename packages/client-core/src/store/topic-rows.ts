// The topic half of `chat-rows.ts`: maps one group's validated topics to their chat rows.
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

function topicOf(raw: unknown): Topic | null {
  const decoded = Schema.decodeUnknownExit(TopicSchema)(raw);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * The validated topics of one group entry: a malformed row is dropped, never rendered;
 * an entry without `topics` (older server) yields none, so the group keeps its legacy row.
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
    visibility: topic.visibility,
    isGeneral: topic.isGeneral,
    archived: false,
    doneAt: topic.doneAt ?? null,
    linkUrl: topic.linkUrl,
    linkLabel: topic.linkLabel,
    activity: topicActivityOf(topic),
    // The topic's people and AIs; an older server omits `memberIds`, and the AIs always
    // come with an `ais` array.
    ...(topic.memberIds === undefined ? {} : { memberIds: [...topic.memberIds] }),
    ais: topic.ais.map((ai) => ({
      id: ai.id,
      name: ai.name,
      ...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl }),
      ...(ai.jid === undefined ? {} : { jid: ai.jid }),
    })),
  };
}

// The AI activity of one topic: a missing field (older server) or an unknown state
// (newer) is left out; the known three keep the server's order.
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
 * One topic becomes its own chat row, keyed by its room JID; the General topic keeps the
 * group's chat id so existing `/c/<jid>` links open it, and a channel's General row carries
 * the channel fields.
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
    visibility,
    handle,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
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
