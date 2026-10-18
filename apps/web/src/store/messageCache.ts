import type { Pin as PinRow } from '@zilar/api-contract';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import {
  decodeMessageCache,
  encodeMessageCache,
  selectCachedChats,
  type MessageCacheSnapshot,
} from '@zilar/client-core/store';
import type { StorageLike } from './realStore';

// effect-plain: the shared codec owns the parsing; this file wraps browser storage.
// The newest messages of the recent chats, for a cold first paint (T-1903).
// The format lives in the shared codec (T-2019); this file keeps web's seam and caps.
export const MESSAGE_CACHE_KEY = 'zilar:messages';
const MAX_CACHED_CHATS = 30;
// The browser gives us about 5 MB; keep the payload well below that.
const MAX_CACHE_BYTES = 1_500_000;
// A URL with these prefixes only works on this device, so it is never stored.
const LOCAL_URL_PREFIXES = ['blob:', 'data:'] as const;
// Writes are throttled after the last message change; `pagehide` flushes at once.
export const MESSAGE_CACHE_WRITE_DELAY_MS = 2_000;

/** Reads the snapshot for `userId`, or `null`; another account's copy is dropped. */
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

/** The cached messages for `userId`, or an empty map when there is none. */
export function readMessageCache(
  storage: StorageLike | null,
  userId: string,
): Record<string, UiMessage[]> {
  return readSnapshot(storage, userId)?.messages ?? {};
}

/** The cached pins of `userId`, or an empty map when there are none. */
export function readCachedPins(
  storage: StorageLike | null,
  userId: string,
): Record<string, PinRow[]> {
  const snapshot = readSnapshot(storage, userId);
  return Object.fromEntries(
    Object.entries(snapshot?.pins ?? {}).map(([chatId, list]) => [chatId, [...list]] as const),
  );
}

// Saves the 30 newest chats in list order, with their pins; the codec caps the
// payload at 1.5 MB, dropping the oldest chats first, then the oldest rows.
export function writeMessageCache(
  storage: StorageLike | null,
  userId: string,
  chats: readonly ChatSummary[],
  messagesByChat: Record<string, UiMessage[]>,
  pinsByChat: Record<string, readonly PinRow[]> = {},
): void {
  if (storage === null || userId === '') return;
  try {
    const messages: Record<string, UiMessage[]> = {};
    for (const chat of selectCachedChats(chats, null, MAX_CACHED_CHATS)) {
      const list = messagesByChat[chat.id];
      if (list !== undefined) messages[chat.id] = list;
    }
    const options = { localUrlPrefixes: LOCAL_URL_PREFIXES, maxBytes: MAX_CACHE_BYTES };
    storage.setItem(
      MESSAGE_CACHE_KEY,
      encodeMessageCache({ userId, messages, pins: pinsByChat }, options),
    );
  } catch {
    // A full or blocked localStorage must never break messaging.
  }
}

export function clearMessageCache(storage: StorageLike | null): void {
  try {
    storage?.removeItem(MESSAGE_CACHE_KEY);
  } catch {
    // Ignore storage failures on the way out.
  }
}
