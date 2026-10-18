// effect-plain: the async expo-file-system seam for the shared codec; failures are swallowed.
import type { ChatSummary } from '@zilar/chat-core';
import { decodeChatListCache, encodeChatListCache } from '@zilar/client-core/store';

export const CHAT_LIST_CACHE_FILE_NAME = 'zilar-chat-list.json';

function cacheUri(documentDirectory: string): string {
  return documentDirectory + CHAT_LIST_CACHE_FILE_NAME;
}

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
 * `chats` keeps unknown fields, so a newer build's cache still paints.
 */
export async function readChatListCache(): Promise<{
  userId: string;
  chats: ChatSummary[];
} | null> {
  const raw = await readCacheFile();
  return raw === null ? null : (decodeChatListCache(raw) ?? null);
}

export function writeChatListCache(userId: string, chats: readonly ChatSummary[]): void {
  if (userId === '') {
    return;
  }
  try {
    void writeCacheFile(encodeChatListCache(userId, chats));
  } catch {
    // A serialization failure must never break messaging.
  }
}

/** Called on sign-out, so one user's list never paints as another's. */
export function clearChatListCache(): void {
  void deleteCacheFile();
}
