// effect-plain: the sync localStorage seam for the shared codec; storage failures are swallowed.
import type { ChatSummary } from '@zilar/chat-core';
import { decodeChatListCache, encodeChatListCache } from '@zilar/client-core/store';
import type { StorageLike } from './realStore';

// The last chat list, painted on reload; the payload is the shared client-core codec.
export const CHAT_LIST_CACHE_KEY = 'zilar:chatList';

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
    return raw === null ? null : (decodeChatListCache(raw, userId) ?? null);
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
    storage.setItem(CHAT_LIST_CACHE_KEY, encodeChatListCache(userId, chats));
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
