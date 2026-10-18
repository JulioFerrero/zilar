// effect-plain: the debounced file queue over the injected expo-file-system port.
/**
 * Only display data is kept: the `UiMessage`s of the 50 most recent chats (50 each) plus the open chat, the owner id and a version. No token and no media bytes, only the attachment URLs the rows carry; a different signed-in user ignores the file and sign-out removes it.
 */
import type { Pin } from '@zilar/api-contract';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import {
  decodeMessageCache,
  encodeMessageCache,
  selectCachedChats,
  type MessageCacheSnapshot,
} from '@zilar/client-core/store';

export const OFFLINE_CACHE_FILE_NAME = 'zilar-offline-cache.json';
const MAX_CACHED_CHATS = 50;
const LOCAL_URL_PREFIXES = ['file://', 'data:'] as const;
// Writes are debounced this long after the last change; the background handler flushes at once.
export const OFFLINE_CACHE_WRITE_DELAY_MS = 2_000;

export type OfflineCacheSnapshot = MessageCacheSnapshot;

/** The file seam: the app's port uses `expo-file-system/legacy`; tests inject an in-memory fake, so no native module loads under Vitest. */
export interface OfflineCachePort {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
  remove(): Promise<void>;
}

export interface OfflineCache {
  /** Null when there is none or it belongs to another user. */
  hydrate(userId: string): Promise<OfflineCacheSnapshot | null>;
  schedule(snapshot: OfflineCacheSnapshot): void;
  flush(): void;
  /** Waits for any in-flight write, then removes the file; no scheduled or late write recreates it until the next `hydrate`. */
  clear(): Promise<void>;
}

export function encodeOfflineCache(snapshot: OfflineCacheSnapshot): string {
  return encodeMessageCache(snapshot, { localUrlPrefixes: LOCAL_URL_PREFIXES });
}

export function decodeOfflineCache(raw: string, userId: string): OfflineCacheSnapshot | null {
  return decodeMessageCache(raw, userId);
}

/** Undefined when no user is signed in (nothing to scope the file to). Only the 50 most recent chats plus the open one, so one entry cannot grow with the whole list. */
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

export function createOfflineCache(port: OfflineCachePort): OfflineCache {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: OfflineCacheSnapshot | undefined;
  // Every write and the removal run in order on this chain, so `clear()` waits for an in-flight write before it removes the file.
  let ops: Promise<void> = Promise.resolve();
  // Set by `clear()`: no scheduled or late write may recreate the file until the next `hydrate`.
  let cleared = false;

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    // Run even after an earlier failure: a failed write costs only the next cold start, and a rejection here must never go unhandled.
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
      // Wait out any pending write or removal, then reopen for writes, so the read never races a sign-out's removal.
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
        // Messaging must not depend on the cache.
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

/** The `expo-secure-store` import is dynamic so this module loads under Vitest, which cannot import the native module. */
export async function readSessionUserId(): Promise<string | undefined> {
  try {
    const { createSecureSessionStorage } = await import('../auth/secure-session-storage');
    return (await createSecureSessionStorage().getMe())?.id;
  } catch {
    return undefined;
  }
}
