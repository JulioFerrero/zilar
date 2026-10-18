/**
 * Sticker ids are not secrets, so they stay out of the keychain, and `readRecentStickers` drops hostile data so a tampered value cannot break the panel.
 */

import { RECENT_STICKERS_KEY } from '@zilar/chat-core';
import { Effect } from 'effect';
import { readRecentStickers, type RecentStickerEntry } from './stickers';

export { RECENT_STICKERS_KEY };

export interface RecentsStorageBackend {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
}

export function createMemoryRecentsBackend(initial?: string): RecentsStorageBackend {
  let raw: string | null = initial ?? null;
  return {
    read: () => Effect.runPromise(Effect.sync(() => raw)),
    write: (next) =>
      Effect.runPromise(
        Effect.sync(() => {
          raw = next;
        }),
      ),
  };
}

let backend: RecentsStorageBackend = createMemoryRecentsBackend();

export function setRecentsBackend(next: RecentsStorageBackend): void {
  backend = next;
}

export const RECENTS_STORAGE = {
  read: (): Promise<string | null> => backend.read(),
  write: (raw: string): Promise<void> => backend.write(raw),
};

const readStoredRecentsEffect = (): Effect.Effect<RecentStickerEntry[]> =>
  Effect.tryPromise({ try: () => backend.read(), catch: () => undefined }).pipe(
    Effect.flatMap((raw) =>
      Effect.try({ try: () => readRecentStickers(raw), catch: () => undefined }),
    ),
    Effect.catch(() => Effect.succeed<RecentStickerEntry[]>([])),
  );

export function readStoredRecents(): Promise<RecentStickerEntry[]> {
  return Effect.runPromise(readStoredRecentsEffect());
}
