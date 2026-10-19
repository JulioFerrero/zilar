// effect-plain: the file port over the injected expo-file-system seam; the shared writer owns the queue.
/** Display data only: at most the 50 newest chats of 50 rows, no token and no media bytes; another user's file is ignored and sign-out removes it. */
import {
  encodeMessageCache,
  type MessageCacheSnapshot,
  type MessageCacheWriterPort,
} from '@zilar/client-core/store';

export const OFFLINE_CACHE_FILE_NAME = 'zilar-offline-cache.json';
export const MAX_CACHED_CHATS = 50;
const LOCAL_URL_PREFIXES = ['file://', 'data:'] as const;
// Writes are debounced this long after the last change; the background handler flushes at once.
export const OFFLINE_CACHE_WRITE_DELAY_MS = 2_000;

/** The file seam: the app's port uses `expo-file-system/legacy`; tests inject an in-memory fake, so no native module loads under Vitest. */
export type OfflineCachePort = MessageCacheWriterPort;

export function encodeOfflineCache(snapshot: MessageCacheSnapshot): string {
  return encodeMessageCache(snapshot, { localUrlPrefixes: LOCAL_URL_PREFIXES });
}

/** A JSON file in the document directory, named by its caller. */
export function fileCachePort(fileName: string): OfflineCachePort {
  const path = async (): Promise<string | null> => {
    const { documentDirectory } = await import('expo-file-system/legacy');
    return documentDirectory === null ? null : documentDirectory + fileName;
  };
  return {
    async read() {
      try {
        const uri = await path();
        if (uri === null) return null;
        const { readAsStringAsync } = await import('expo-file-system/legacy');
        return await readAsStringAsync(uri);
      } catch {
        return null;
      }
    },
    async write(contents) {
      try {
        const uri = await path();
        if (uri === null) return;
        const { writeAsStringAsync } = await import('expo-file-system/legacy');
        await writeAsStringAsync(uri, contents);
      } catch {
        // Messaging must not depend on the cache.
      }
    },
    async remove() {
      try {
        const uri = await path();
        if (uri === null) return;
        const { deleteAsync } = await import('expo-file-system/legacy');
        await deleteAsync(uri, { idempotent: true });
      } catch {
        // Ignore the failure on the way out.
      }
    },
  };
}

export const defaultOfflineCachePort = (): OfflineCachePort =>
  fileCachePort(OFFLINE_CACHE_FILE_NAME);

/** The `expo-secure-store` import is dynamic so this module loads under Vitest, which cannot import the native module. */
export async function readSessionUserId(): Promise<string | undefined> {
  try {
    const { createSecureSessionStorage } = await import('../auth/secure-session-storage');
    return (await createSecureSessionStorage().getMe())?.id;
  } catch {
    return undefined;
  }
}
