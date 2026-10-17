/**
 * The newest messages of the recent chats, so a cold start opens an open chat
 * at once, online or offline (T-1313), the way Telegram opens on its local
 * copy. The chat list itself is the existing `@/lib/chat-list-cache`
 * (PERF-12): this file never stores it a second time. One JSON file under the
 * app's documents directory through `expo-file-system/legacy`, the storage the
 * app already uses for small per-device JSON (`lib/composer-drafts.ts`,
 * `lib/voice-transcripts.ts`); no new dependency is added.
 *
 * Only display data is kept: the `UiMessage`s of the 50 most recent chats (50
 * each) plus the chat currently open when it falls outside those, the owner's
 * user id and a version. No token and no media bytes, only the attachment URLs
 * the rows already carry. A different signed-in user ignores the file (the
 * owner must match) and the next save replaces it; sign-out removes it.
 */
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';

/** The cache file name; one file per install (removed on sign-out). */
export const OFFLINE_CACHE_FILE_NAME = 'zilar-offline-cache.json';
const CACHE_VERSION = 1;
const MAX_CACHED_CHATS = 50;
const MAX_CACHED_MESSAGES = 50;
// Writes are debounced this long after the last change; the app's background
// handler flushes the pending write at once (`effects/lifecycle.ts`).
export const OFFLINE_CACHE_WRITE_DELAY_MS = 2_000;

/** The cache's contents: one signed-in user's recent messages. */
export interface OfflineCacheSnapshot {
  userId: string;
  messages: Record<string, UiMessage[]>;
}

/**
 * The file seam: the only thing the cache talks to outside itself. The app's
 * port uses `expo-file-system/legacy`; tests inject an in-memory fake, so no
 * native module is loaded under Vitest.
 */
export interface OfflineCachePort {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
  remove(): Promise<void>;
}

export interface OfflineCache {
  /** The cached snapshot for `userId`, or null when there is none or it is another user's. */
  hydrate(userId: string): Promise<OfflineCacheSnapshot | null>;
  /** Debounces a write of this snapshot (~2 s after the last change). */
  schedule(snapshot: OfflineCacheSnapshot): void;
  /** Writes the pending snapshot now (app to background); a no-op when idle. */
  flush(): void;
  /**
   * Waits for any in-flight write, then removes the file (sign-out). Until the
   * next `hydrate` no scheduled or late write recreates it.
   */
  clear(): Promise<void>;
}

// Unknown keys are kept, like the chat-list cache's schema: a newer build may
// add fields to a cached row and an older cache must still paint it.
const passthrough = [Schema.Record(Schema.String, Schema.Unknown)] as const;

// A message is written with `createdAt` as an ISO string; nothing else changes.
const cachedMessageSchema = Schema.StructWithRest(
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

const cacheSchema = struct({
  version: Schema.Literal(CACHE_VERSION),
  userId: Schema.String,
  messages: Schema.Record(Schema.String, Schema.mutable(Schema.Array(cachedMessageSchema))),
});

// The mobile-only fields the cache must drop: the `file://` preview and the
// upload progress live beside the shared `UiMessage` (`lib/types.ts`,
// `MobileMessage`), never on the wire, so they must never reach the file.
type LocalOnlyFields = { localUri?: string | undefined; uploadProgress?: number | undefined };

function isLocalUrl(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('data:');
}

/**
 * Whether a message may be cached. A `local-*` id is a still-unacked optimistic
 * send: the ledger's `wireTargetFor` (`packages/client-core/src/store/ledger-ids.ts`)
 * reports no server id for one, so on restart the server echo would show the
 * message twice (once under each id). A `sending` or `failed` one is in flight
 * or broken: keeping it would show a clock or a Retry that can never settle.
 */
function isCacheable(message: UiMessage): boolean {
  return (
    message.status !== 'sending' && message.status !== 'failed' && !message.id.startsWith('local-')
  );
}

/** Drops the local-only upload fields and any `file://` preview url they left behind. */
function stripLocalFields(message: UiMessage): UiMessage {
  const {
    localUri: _localUri,
    uploadProgress: _uploadProgress,
    ...rest
  } = message as UiMessage & LocalOnlyFields;
  const cleaned: UiMessage = { ...rest };
  if (cleaned.attachment !== undefined && isLocalUrl(cleaned.attachment.url)) {
    delete cleaned.attachment;
  }
  if (cleaned.image !== undefined && isLocalUrl(cleaned.image.url)) {
    delete cleaned.image;
  }
  if (cleaned.voice?.url !== undefined && isLocalUrl(cleaned.voice.url)) {
    delete cleaned.voice;
  }
  return cleaned;
}

/** Encodes one message; only `createdAt` needs the string form. */
function encodeMessage(message: UiMessage): Record<string, unknown> {
  const cleaned = stripLocalFields(message);
  return { ...cleaned, createdAt: cleaned.createdAt.toISOString() };
}

export function encodeOfflineCache(snapshot: OfflineCacheSnapshot): string {
  const messages: Record<string, Record<string, unknown>[]> = {};
  for (const [chatId, list] of Object.entries(snapshot.messages)) {
    messages[chatId] = list.filter(isCacheable).slice(-MAX_CACHED_MESSAGES).map(encodeMessage);
  }
  return JSON.stringify({
    version: CACHE_VERSION,
    userId: snapshot.userId,
    messages,
  });
}

function decodeMessage(message: Schema.Schema.Type<typeof cachedMessageSchema>): UiMessage {
  const createdAt = new Date(message.createdAt);
  return {
    ...(message as unknown as UiMessage),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt,
  };
}

/**
 * Parses the file for `userId`, or null when it is unusable or another user's.
 * A corrupt, truncated or older-version file reads as "none", so it can never
 * break the start.
 */
export function decodeOfflineCache(raw: string, userId: string): OfflineCacheSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const decoded = Schema.decodeUnknownResult(cacheSchema)(parsed);
  if (!Result.isSuccess(decoded)) {
    return null;
  }
  if (decoded.success.userId !== userId) {
    return null;
  }
  const messages: Record<string, UiMessage[]> = {};
  for (const [chatId, list] of Object.entries(decoded.success.messages)) {
    messages[chatId] = list.map(decodeMessage);
  }
  return { userId: decoded.success.userId, messages };
}

/**
 * The chats to keep: the first MAX_CACHED_CHATS in display order, plus the
 * chat currently open when it falls outside them (a topic, or a chat opened
 * from a notification), so it starts from the local copy too.
 */
function cachedChats(
  chats: readonly ChatSummary[],
  activeChatId: string | null | undefined,
): readonly ChatSummary[] {
  const first = chats.slice(0, MAX_CACHED_CHATS);
  if (activeChatId === null || activeChatId === undefined) {
    return first;
  }
  if (first.some((chat) => chat.id === activeChatId)) {
    return first;
  }
  const active = chats.find((chat) => chat.id === activeChatId);
  return active === undefined ? first : [...first, active];
}

/**
 * Builds the snapshot to persist from the store's live values, or undefined
 * when no user is signed in (nothing to scope the file to). Only the 50 most
 * recent chats are kept, plus the open one, so one cache entry can never grow
 * with the whole list.
 */
export function offlineSnapshot(
  userId: string | undefined,
  chats: readonly ChatSummary[],
  messages: Record<string, UiMessage[]>,
  activeChatId?: string | null,
): OfflineCacheSnapshot | undefined {
  if (userId === undefined || userId === '') {
    return undefined;
  }
  const recent: Record<string, UiMessage[]> = {};
  for (const chat of cachedChats(chats, activeChatId)) {
    const list = messages[chat.id];
    if (list !== undefined) {
      recent[chat.id] = list;
    }
  }
  return { userId, messages: recent };
}

/** The cache over one file port, with the debounced write and the removal. */
export function createOfflineCache(port: OfflineCachePort): OfflineCache {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: OfflineCacheSnapshot | undefined;
  // Every write and the removal run in order on this chain, so `clear()` waits
  // for an in-flight write before it removes the file (privacy).
  let ops: Promise<void> = Promise.resolve();
  // Set by `clear()`: no scheduled or late write may recreate the file until
  // the next `hydrate` (a new start or sign-in for a user).
  let cleared = false;

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    // Run even after an earlier failure; a failed write costs only the next
    // cold start, and a rejection here must never go unhandled.
    ops = ops.then(task, task).catch(() => undefined);
    return ops;
  }

  function flush(): void {
    cancelTimer();
    const snapshot = pending;
    pending = undefined;
    if (snapshot === undefined || cleared) {
      return;
    }
    const contents = encodeOfflineCache(snapshot);
    // Fire-and-forget: a failed write costs only the next cold start.
    void enqueue(() => port.write(contents));
  }

  function schedule(snapshot: OfflineCacheSnapshot): void {
    if (cleared) {
      return;
    }
    pending = snapshot;
    cancelTimer();
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, OFFLINE_CACHE_WRITE_DELAY_MS);
  }

  return {
    async hydrate(userId) {
      // Wait out any pending write or removal, then reopen for writes, so the
      // read never races a sign-out's removal.
      await ops;
      cleared = false;
      const raw = await port.read();
      return raw === null ? null : decodeOfflineCache(raw, userId);
    },
    schedule,
    flush,
    clear() {
      cancelTimer();
      pending = undefined;
      cleared = true;
      return enqueue(() => port.remove());
    },
  };
}

/** The app's file port: the cache JSON under the documents directory. */
export function defaultOfflineCachePort(): OfflineCachePort {
  const uri = async (): Promise<string | null> => {
    const { documentDirectory } = await import('expo-file-system/legacy');
    return documentDirectory === null ? null : documentDirectory + OFFLINE_CACHE_FILE_NAME;
  };
  return {
    async read() {
      try {
        const path = await uri();
        if (path === null) {
          return null;
        }
        const { readAsStringAsync } = await import('expo-file-system/legacy');
        return await readAsStringAsync(path);
      } catch {
        return null;
      }
    },
    async write(contents) {
      try {
        const path = await uri();
        if (path === null) {
          return;
        }
        const { writeAsStringAsync } = await import('expo-file-system/legacy');
        await writeAsStringAsync(path, contents);
      } catch {
        // Ignore the failure: messaging must not depend on the cache.
      }
    },
    async remove() {
      try {
        const path = await uri();
        if (path === null) {
          return;
        }
        const { deleteAsync } = await import('expo-file-system/legacy');
        await deleteAsync(path, { idempotent: true });
      } catch {
        // Ignore the failure on the way out.
      }
    },
  };
}

/**
 * The signed-in user id for the owner check, from the cached profile beside the
 * session token (T-1304). The `expo-secure-store` import is dynamic so this
 * module loads under Vitest (Node), which cannot import the native module.
 */
export async function readSessionUserId(): Promise<string | undefined> {
  try {
    const { createSecureSessionStorage } = await import('../auth/secure-session-storage');
    return (await createSecureSessionStorage().getMe())?.id;
  } catch {
    return undefined;
  }
}
