import type { ChatSummary } from '@zilar/chat-core';
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';
import type { StorageLike } from './realStore';

// The last chat list the user saw, so a reload paints it at once in the same
// order, with previews, instead of a bare list that re-sorts a second later.
// It is only a first paint: the server and XMPP data replace it right after.
export const CHAT_LIST_CACHE_KEY = 'zilar:chatList';
const CACHE_VERSION = 1;
const MAX_CACHED_CHATS = 200;

// Unknown keys are kept, like the old zod `.passthrough()`: a newer build may
// add fields to a cached summary and an older cache must still paint it.
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

/** The cached list for `userId`, or null when there is none or it is unusable. */
export function readChatListCache(
  storage: StorageLike | null,
  userId?: string,
): { userId: string; chats: ChatSummary[] } | null {
  if (storage === null) {
    return null;
  }
  try {
    const raw = storage.getItem(CHAT_LIST_CACHE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = Schema.decodeUnknownResult(cacheSchema)(JSON.parse(raw));
    if (!Result.isSuccess(parsed) || (userId !== undefined && parsed.success.userId !== userId)) {
      return null;
    }
    const chats = parsed.success.chats.map((chat) => {
      const { lastMessage, lastSeenAt: _lastSeenAt, online: _online, ...rest } = chat;
      const summary = { ...rest } as unknown as ChatSummary;
      if (lastMessage !== undefined) {
        const createdAt = new Date(lastMessage.createdAt);
        if (!Number.isNaN(createdAt.getTime())) {
          summary.lastMessage = {
            ...(lastMessage as unknown as NonNullable<ChatSummary['lastMessage']>),
            createdAt,
          };
        }
      }
      return summary;
    });
    return { userId: parsed.success.userId, chats };
  } catch {
    return null;
  }
}

export function writeChatListCache(
  storage: StorageLike | null,
  userId: string,
  chats: readonly ChatSummary[],
): void {
  if (storage === null || userId === '') {
    return;
  }
  try {
    const payload = {
      version: CACHE_VERSION,
      userId,
      chats: chats.slice(0, MAX_CACHED_CHATS).map((chat) => ({
        ...chat,
        // Presence is live state: never paint a stale "online".
        online: undefined,
        onlineCount: undefined,
        lastSeenAt: undefined,
        lastMessage:
          chat.lastMessage === undefined
            ? undefined
            : { ...chat.lastMessage, createdAt: chat.lastMessage.createdAt.toISOString() },
      })),
    };
    storage.setItem(CHAT_LIST_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // A full or blocked localStorage must never break messaging.
  }
}

export function clearChatListCache(storage: StorageLike | null): void {
  try {
    storage?.removeItem(CHAT_LIST_CACHE_KEY);
  } catch {
    // Ignore storage failures on the way out.
  }
}
