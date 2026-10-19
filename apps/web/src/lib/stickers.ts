/** The last 30 sent, kept in localStorage as ids; the shared parser drops hostile data. */

import { orFallback } from './emojiRecents';
import {
  addRecentSticker,
  parseRecentStickers,
  RECENT_STICKERS_KEY,
  type RecentStickerEntry,
} from '@zilar/chat-core';

export function readRecentStickers(storage: Storage | null): RecentStickerEntry[] {
  if (storage === null) {
    return [];
  }
  return orFallback<RecentStickerEntry[]>([], () =>
    parseRecentStickers(storage.getItem(RECENT_STICKERS_KEY)),
  );
}

/** Records a sent sticker first; a failing storage never breaks sending. */
export function rememberRecentSticker(
  storage: Storage | null,
  entry: RecentStickerEntry,
): RecentStickerEntry[] {
  const next = addRecentSticker(readRecentStickers(storage), entry);
  writeRecentStickers(storage, next);
  return next;
}

/** Drops a sticker from the recents (its file is gone); a blocked storage still returns the list. */
export function forgetRecentSticker(
  storage: Storage | null,
  stickerId: string,
): RecentStickerEntry[] {
  const next = readRecentStickers(storage).filter((item) => item.stickerId !== stickerId);
  writeRecentStickers(storage, next);
  return next;
}

function writeRecentStickers(
  storage: Storage | null,
  recents: readonly RecentStickerEntry[],
): void {
  if (storage === null) {
    return;
  }
  // A full or blocked localStorage must never break sending.
  orFallback<void>(undefined, () => {
    storage.setItem(RECENT_STICKERS_KEY, JSON.stringify(recents));
  });
}
