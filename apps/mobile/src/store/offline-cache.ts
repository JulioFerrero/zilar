// effect-plain: the debounced file queue over the injected expo-file-system port; the codec and its Effect schemas now live in @zilar/client-core
/**
 * The newest messages of the recent chats, so a cold start opens an open chat
 * at once, online or offline (T-1313), the way Telegram opens on its local
 * copy. The chat list itself is the existing `@/lib/chat-list-cache`
 * (PERF-12): this file never stores it a second time. One JSON file under the
 * app's documents directory through `expo-file-system/legacy`, the storage the
 * app already uses for small per-device JSON (`lib/composer-drafts.ts`,
 * `lib/voice-transcripts.ts`); no new dependency is added.
 *
 * The format is the shared codec in `@zilar/client-core/store` (T-2019); this
 * file keeps the phone's file queue. Only display data is kept: the
 * `UiMessage`s of the 50 most recent chats (50 each) plus the chat currently
 * open when it falls outside those, the owner's user id and a version. No
 * token and no media bytes, only the attachment URLs the rows already carry. A
 * different signed-in user ignores the file (the owner must match) and the
 * next save replaces it; sign-out removes it.
 */
import type { Pin } from '@zilar/api-contract';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import {
  decodeMessageCache,
  encodeMessageCache,
  selectCachedChats,
  type MessageCacheSnapshot,
} from '@zilar/client-core/store';

/** The cache file name; one file per install (removed on sign-out). */
export const OFFLINE_CACHE_FILE_NAME = 'zilar-offline-cache.json';
const MAX_CACHED_CHATS = 50;
const LOCAL_URL_PREFIXES = ['file://', 'data:'] as const;
// Writes are debounced this long after the last change; the app's background
// handler flushes the pending write at once (`effects/lifecycle.ts`).
export const OFFLINE_CACHE_WRITE_DELAY_MS = 2_000;

/** The cache's contents: one signed-in user's recent messages and their pins. */
export type OfflineCacheSnapshot = MessageCacheSnapshot;

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

/** Encodes the snapshot with the shared codec, dropping this device's media urls. */
export function encodeOfflineCache(snapshot: OfflineCacheSnapshot): string {
  return encodeMessageCache(snapshot, { localUrlPrefixes: LOCAL_URL_PREFIXES });
}

/** Parses the file for `userId`, or null when it is unusable or another user's. */
export function decodeOfflineCache(raw: string, userId: string): OfflineCacheSnapshot | null {
  return decodeMessageCache(raw, userId);
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
  pinsFor?: (chatId: string) => readonly Pin[],
): OfflineCacheSnapshot | undefined {
  if (userId === undefined || userId === '') {
    return undefined;
  }
  const recent: Record<string, UiMessage[]> = {};
  const pins: Record<string, Pin[]> = {};
  for (const chat of selectCachedChats(chats, activeChatId, MAX_CACHED_CHATS)) {
    const list = messages[chat.id];
    if (list !== undefined) {
      recent[chat.id] = list;
    }
    const pinned = pinsFor?.(chat.id) ?? [];
    if (pinned.length > 0) {
      pins[chat.id] = [...pinned];
    }
  }
  return { userId, messages: recent, pins };
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
