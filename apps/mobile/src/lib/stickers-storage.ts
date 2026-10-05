/**
 * Per-device sticker recents storage (T-0143): a small JSON list of sticker
 * ids kept outside the keychain (they are not secrets), so a tampered value
 * can never break the panel — `readRecentStickers` drops hostile data.
 *
 * `SecureStore` cannot hold this: it is async-string-only per key with no
 * test seam on mobile, so recents use an in-memory store injected by the app
 * (persisted per device by a later task; mock mode keeps them for the
 * session).
 */

import { readRecentStickers, type RecentStickerEntry } from './stickers';

export const RECENT_STICKERS_KEY = 'zilar:recentStickers';

export interface RecentsStorageBackend {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
}

/** In-memory backend: the default until a persisted device store lands. */
export function createMemoryRecentsBackend(initial?: string): RecentsStorageBackend {
  let raw: string | null = initial ?? null;
  return {
    read: () => Promise.resolve(raw),
    write: (next) => {
      raw = next;
      return Promise.resolve();
    },
  };
}

let backend: RecentsStorageBackend = createMemoryRecentsBackend();

/** Swaps the recents backend (tests and the app's persisted store). */
export function setRecentsBackend(next: RecentsStorageBackend): void {
  backend = next;
}

/** The recents storage the composer hands to the sticker panel. */
export const RECENTS_STORAGE = {
  read: (): Promise<string | null> => backend.read(),
  write: (raw: string): Promise<void> => backend.write(raw),
};

/** Reads the recents; hostile or missing data resolves to an empty list. */
export async function readStoredRecents(): Promise<RecentStickerEntry[]> {
  try {
    return readRecentStickers(await backend.read());
  } catch {
    return [];
  }
}
