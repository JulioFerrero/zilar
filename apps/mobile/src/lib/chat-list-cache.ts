/**
 * The last chat list the user saw, so a cold start paints it at once instead of
 * waiting for `/api/chats` (PERF-12). The mobile twin of web's
 * `apps/web/src/store/chatListCache.ts`: the same payload shape, the same
 * passthrough decoding, the same dropped live fields.
 *
 * It is stored as one JSON file at `<documents>/zilar-chat-list.json` through
 * `expo-file-system/legacy`, the storage the app already uses for small
 * per-device JSON (`lib/composer-drafts.ts`, `lib/voice-transcripts.ts`); no new
 * dependency is added. Only the chat summary and the message preview are kept,
 * never the message bodies.
 */
import type { ChatSummary } from '@zilar/chat-core';
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';

/** The cache file name; one file per install (cleared on sign-out). */
export const CHAT_LIST_CACHE_FILE_NAME = 'zilar-chat-list.json';
const CACHE_VERSION = 1;
const MAX_CACHED_CHATS = 200;

// Unknown keys are kept, like web's schema: a newer build may add fields to a
// cached summary and an older cache must still paint it.
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

function cacheUri(documentDirectory: string): string {
  return documentDirectory + CHAT_LIST_CACHE_FILE_NAME;
}

/** Reads the cache file; a missing file or platform resolves to null. */
async function readCacheFile(): Promise<string | null> {
  try {
    const { documentDirectory, readAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return null;
    }
    return await readAsStringAsync(cacheUri(documentDirectory));
  } catch {
    return null;
  }
}

/** Writes the cache file; a read-only or full disk is ignored. */
async function writeCacheFile(contents: string): Promise<void> {
  try {
    const { documentDirectory, writeAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return;
    }
    await writeAsStringAsync(cacheUri(documentDirectory), contents);
  } catch {
    // Ignore the failure: messaging must not depend on the cache.
  }
}

/** Deletes the cache file; a missing file or a blocked disk is ignored. */
async function deleteCacheFile(): Promise<void> {
  try {
    const { documentDirectory, deleteAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return;
    }
    await deleteAsync(cacheUri(documentDirectory), { idempotent: true });
  } catch {
    // Ignore the failure on the way out.
  }
}

/**
 * The cached list, or null when there is none, it is unusable, or its user did
 * not match. `chats` keeps unknown fields, so a newer build's cache still paints.
 */
export async function readChatListCache(): Promise<{
  userId: string;
  chats: ChatSummary[];
} | null> {
  const raw = await readCacheFile();
  if (raw === null) {
    return null;
  }
  try {
    const parsed = Schema.decodeUnknownResult(cacheSchema)(JSON.parse(raw));
    if (!Result.isSuccess(parsed)) {
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

/**
 * Saves the last list for the next visit. Fire-and-forget (the file write is
 * async while the core hook is sync); a failure costs only the cached paint.
 */
export function writeChatListCache(userId: string, chats: readonly ChatSummary[]): void {
  if (userId === '') {
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
    void writeCacheFile(JSON.stringify(payload));
  } catch {
    // A serialization failure must never break messaging.
  }
}

/** Forgets the cache; called on sign-out so one user's list never paints as another's. */
export function clearChatListCache(): void {
  void deleteCacheFile();
}
