/** The last 30 sent, kept in localStorage as ids; the shared parser drops hostile data. */

import { Effect } from 'effect';
import {
  addRecentSticker,
  isStickerFileUrl,
  MAX_RECENT_STICKERS,
  parseRecentStickers,
  RECENT_STICKERS_KEY,
  type RecentStickerEntry,
} from '@zilar/chat-core';

export { MAX_RECENT_STICKERS, RECENT_STICKERS_KEY };
export type { RecentStickerEntry };

/** A throw gives fallback, so hostile or blocked input never breaks the caller. */
function orFallback<A>(fallback: A, step: () => A): A {
  return Effect.runSync(Effect.try(step).pipe(Effect.orElseSucceed(() => fallback)));
}

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

/** Whether a sticker payload url may be auto-loaded: only on the Zilar API's own origin.
 * A hostile sender's URL shows a placeholder instead, so nobody's browser fetches it. */
export function isSameOriginStickerUrl(url: string, apiBase: string = '/api'): boolean {
  // An unparsable base is not same-origin: the placeholder shows.
  return orFallback(false, () =>
    isStickerFileUrl(url, new URL(apiBase, window.location.origin).origin),
  );
}

/** Whether the panel may show a thumbnail inline: same-origin file URLs only. Anything else
 * (a hostile URL in localStorage recents) shows the emoji tile, so the browser never fetches it. */
export function isPanelStickerUrl(url: string): boolean {
  return isSameOriginStickerUrl(url);
}
