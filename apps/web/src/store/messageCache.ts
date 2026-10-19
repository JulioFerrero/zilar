import type { Pin as PinRow } from '@zilar/api-contract';
import type { UiMessage } from '@zilar/chat-core';
import {
  createMessageCacheWriter,
  decodeMessageCache,
  encodeMessageCache,
  type MessageCacheSnapshot,
  type MessageCacheWriter,
  type MessageCacheWriterPort,
} from '@zilar/client-core/store';
import type { StorageLike } from './realStore';

// effect-plain: the shared codec owns the parsing; this file wraps browser storage and its caps.
export const MESSAGE_CACHE_KEY = 'zilar:messages';
export const MAX_CACHED_CHATS = 30;
// The browser gives us about 5 MB; keep the payload well below that.
const MAX_CACHE_BYTES = 1_500_000;
// A URL with these prefixes only works on this device, so it is never stored.
const LOCAL_URL_PREFIXES = ['blob:', 'data:'] as const;
// Writes are throttled after the last message change; pagehide flushes at once.
export const MESSAGE_CACHE_WRITE_DELAY_MS = 2_000;

/** Reads the snapshot for userId, or null; another account's copy is dropped. */
function readSnapshot(storage: StorageLike | null, userId: string): MessageCacheSnapshot | null {
  if (storage === null || userId === '') return null;
  try {
    const raw = storage.getItem(MESSAGE_CACHE_KEY);
    if (raw === null) return null;
    const snapshot = decodeMessageCache(raw, userId);
    if (snapshot !== null) return snapshot;
    const owner = (JSON.parse(raw) as { userId?: unknown } | null)?.userId;
    if (typeof owner === 'string' && owner !== userId) storage.removeItem(MESSAGE_CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

export function readMessageCache(
  storage: StorageLike | null,
  userId: string,
): Record<string, UiMessage[]> {
  return readSnapshot(storage, userId)?.messages ?? {};
}

export function readCachedPins(
  storage: StorageLike | null,
  userId: string,
): Record<string, PinRow[]> {
  const snapshot = readSnapshot(storage, userId);
  return Object.fromEntries(
    Object.entries(snapshot?.pins ?? {}).map(([chatId, list]) => [chatId, [...list]] as const),
  );
}

function safely(storage: StorageLike | null, task: (target: StorageLike) => void): void {
  if (storage === null) return;
  try {
    task(storage);
  } catch {
    // Storage failures must never break messaging.
  }
}

function messageCachePort(storage: StorageLike | null): MessageCacheWriterPort {
  return {
    async read() {
      try {
        return storage?.getItem(MESSAGE_CACHE_KEY) ?? null;
      } catch {
        return null;
      }
    },
    async write(contents) {
      safely(storage, (target) => target.setItem(MESSAGE_CACHE_KEY, contents));
    },
    async remove() {
      safely(storage, (target) => target.removeItem(MESSAGE_CACHE_KEY));
    },
  };
}

// Saves the 30 newest chats in list order, with their pins; the codec caps the payload at
// 1.5 MB, dropping the oldest chats first, then the oldest rows.
export function createWebMessageCache(storage: StorageLike | null): MessageCacheWriter {
  return createMessageCacheWriter(messageCachePort(storage), {
    delayMs: MESSAGE_CACHE_WRITE_DELAY_MS,
    encode: (snapshot) =>
      encodeMessageCache(snapshot, {
        localUrlPrefixes: LOCAL_URL_PREFIXES,
        maxBytes: MAX_CACHE_BYTES,
      }),
  });
}

export function clearMessageCache(storage: StorageLike | null): void {
  safely(storage, (target) => target.removeItem(MESSAGE_CACHE_KEY));
}
