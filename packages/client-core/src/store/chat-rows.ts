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
import type {
  ChatSummary,
  TopicAiActivity,
  TopicAiState,
  TopicInfo,
  UiMessage,
} from '@zilar/chat-core';
import { Exit, Schema } from 'effect';
import {
  Topic as TopicSchema,
  type ChatEntry,
  type GroupBackground,
  type Topic,
} from '@zilar/api-contract';

/** The `/api/chats` unread fields, read loosely (both apps decode entries
 * on their own, and an older server omits them). */
export interface ServerRowFields {
  readonly unread?: unknown;
  readonly lastMessage?: unknown;
  /** T-1318: when the chat was created or the caller joined, an ISO datetime. */
  readonly createdAt?: unknown;
  /** T-1238: the delivered mark, an archive id in the caller's terms. */
  readonly deliveredUntil?: unknown;
  /** T-1311: the peer's read mark (DMs), an archive id in the caller's terms. */
  readonly readUntil?: unknown;
}

function archiveMarkOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/** T-1318: the chat's creation/join time from the wire, or undefined when unusable. */
function createdAtOf(raw: unknown): Date | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function unreadOf(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function previewParts(
  raw: unknown,
):
  | { id: string; text: string; senderName?: string | undefined; archiveId?: string | undefined }
  | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = raw as {
    id?: unknown;
    text?: unknown;
    senderName?: unknown;
    archiveId?: unknown;
  };
  if (typeof value.id !== 'string' || typeof value.text !== 'string') {
    return undefined;
  }
  // T-1214: the preview keeps the origin id as its `id` (markers, quote
  // jumps and dedupe all key on it); the archive id rides separately as
  // the read mark for `clearActiveChatRead` / `recordRead`.
  const archiveId =
    typeof value.archiveId === 'string' && value.archiveId !== '' ? value.archiveId : undefined;
  return value.senderName === undefined || typeof value.senderName === 'string'
    ? { id: value.id, text: value.text, senderName: value.senderName, archiveId }
    : { id: value.id, text: value.text, archiveId };
}

/** The server preview as a display-only `UiMessage` (see the header). */
export function previewMessageOf(chatId: string, raw: unknown): UiMessage | undefined {
  const parts = previewParts(raw);
  if (parts === undefined) {
    return undefined;
  }
  const at = (raw as { at?: unknown }).at;
  if (typeof at !== 'string') {
    return undefined;
  }
  const createdAt = new Date(at);
  if (Number.isNaN(createdAt.getTime())) {
    return undefined;
  }
  return {
    id: parts.id,
    chatId,
    senderId: parts.senderName ?? '',
    senderName: parts.senderName ?? '',
    text: parts.text,
    createdAt,
    status: 'sent',
    ...(parts.archiveId === undefined ? {} : { archiveId: parts.archiveId }),
  };
}

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
        ...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl }),
        state: entry.state,
      });
    }
  }
  return rows;
}

function isTopicAiState(state: string): state is TopicAiState {
  return state === 'working' || state === 'waiting' || state === 'done';
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
