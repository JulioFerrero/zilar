// The chat-list cache codec shared by web and phone: version, cap, schemas, dates;
// storage stays per app.
import type { ChatSummary } from '@zilar/chat-core';
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';

const CACHE_VERSION = 1;
const MAX_CACHED_CHATS = 200;

// Unknown keys are kept, like zod's `.passthrough()`: a newer cache still paints.
const passthrough = [Schema.Record(Schema.String, Schema.Unknown)] as const;
const lastMessageSchema = Schema.StructWithRest(
  struct({
    id: Schema.String,
    chatId: Schema.String,
    senderId: Schema.String,
    senderName: Schema.String,
    text: Schema.optional(Schema.String),
    createdAt: Schema.String,
    status: Schema.String,
  }),
  passthrough,
);

const cachedChatSchema = Schema.StructWithRest(
  struct({
    id: Schema.String,
    title: Schema.String,
    kind: Schema.String,
    isAI: Schema.Boolean,
    space: Schema.String,
    unread: Schema.Number,
    muted: Schema.Boolean,
    lastMessage: Schema.optional(lastMessageSchema),
  }),
  passthrough,
);

const cacheSchema = struct({
  version: Schema.Literal(CACHE_VERSION),
  userId: Schema.String,
  chats: Schema.mutable(Schema.Array(cachedChatSchema)),
});

// A cached `Date` arrives as a string; a valid one becomes a `Date`, else it is dropped.
function rehydrateDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function decodeChatListCache(
  raw: string,
  userId?: string,
): { userId: string; chats: ChatSummary[] } | undefined {
  try {
    const parsed = Schema.decodeUnknownResult(cacheSchema)(JSON.parse(raw));
    if (!Result.isSuccess(parsed) || (userId !== undefined && parsed.success.userId !== userId)) {
      return undefined;
    }
    const chats = parsed.success.chats.map((chat) => {
      const {
        lastMessage,
        lastSeenAt: _lastSeenAt,
        online: _online,
        createdAt: rawCreatedAt,
        pinnedAt: rawPinnedAt,
        ...rest
      } = chat;
      const summary = { ...rest } as unknown as ChatSummary;
      const createdAt = rehydrateDate(rawCreatedAt);
      if (createdAt !== undefined) summary.createdAt = createdAt;
      const pinnedAt = rehydrateDate(rawPinnedAt);
      if (pinnedAt !== undefined) summary.pinnedAt = pinnedAt;
      if (lastMessage !== undefined) {
        const messageCreatedAt = new Date(lastMessage.createdAt);
        if (!Number.isNaN(messageCreatedAt.getTime())) {
          summary.lastMessage = {
            ...(lastMessage as unknown as NonNullable<ChatSummary['lastMessage']>),
            createdAt: messageCreatedAt,
          };
        }
      }
      return summary;
    });
    return { userId: parsed.success.userId, chats };
  } catch {
    return undefined;
  }
}

export function encodeChatListCache(userId: string, chats: readonly ChatSummary[]): string {
  return JSON.stringify({
    version: CACHE_VERSION,
    userId,
    chats: chats.slice(0, MAX_CACHED_CHATS).map((chat) => ({
      ...chat,
      // Presence is live state: never paint a stale "online".
      online: undefined,
      onlineCount: undefined,
      lastSeenAt: undefined,
      // `aiStatus` is live too; never paint a stale "working".
      aiStatus: undefined,
      lastMessage:
        chat.lastMessage === undefined
          ? undefined
          : { ...chat.lastMessage, createdAt: chat.lastMessage.createdAt.toISOString() },
    })),
  });
}
