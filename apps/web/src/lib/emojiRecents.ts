import { Effect, Schema } from 'effect';
import type { StorageLike } from '@/store/effects/portTypes';

/** Newest first, deduplicated, at most 24. Hostile stored data (wrong shapes, huge arrays)
 * is ignored, so a tampered value can never break the panel. */
export const EMOJI_RECENTS_KEY = 'zilar:emojiRecents';
export const MAX_RECENT_EMOJI = 24;

// The stored value must be a JSON array; anything else reads as empty.
const decodeRecents = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Unknown)));

/** A throw gives fallback, so a blocked storage never breaks the panel. */
export function orFallback<A>(fallback: A, step: () => A): A {
  return Effect.runSync(Effect.try(step).pipe(Effect.orElseSucceed(() => fallback)));
}

export function readEmojiRecents(storage: StorageLike | null): string[] {
  if (storage === null) {
    return [];
  }
  const raw = orFallback<string | null>(null, () => storage.getItem(EMOJI_RECENTS_KEY));
  if (raw === null || raw === '') {
    return [];
  }
  const parsed = orFallback<readonly unknown[]>([], () => decodeRecents(raw));
  const recents: string[] = [];
  for (const item of parsed) {
    // A glyph is a few code points at most; anything longer is not ours.
    if (
      typeof item === 'string' &&
      item.length > 0 &&
      item.length <= 32 &&
      !recents.includes(item)
    ) {
      recents.push(item);
    }
    if (recents.length === MAX_RECENT_EMOJI) {
      break;
    }
  }
  return recents;
}

/** Records a picked emoji first; a failing storage never breaks the pick. */
export function rememberEmojiRecent(storage: StorageLike | null, emoji: string): string[] {
  if (emoji === '') {
    return readEmojiRecents(storage);
  }
  const next = [emoji, ...readEmojiRecents(storage).filter((item) => item !== emoji)].slice(
    0,
    MAX_RECENT_EMOJI,
  );
  if (storage !== null) {
    orFallback<void>(undefined, () => {
      storage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(next));
    });
  }
  return next;
}

/** Drops the recents on sign-out; a blocked storage is ignored. */
export function clearEmojiRecents(storage: StorageLike | null): void {
  if (storage === null) {
    return;
  }
  orFallback<void>(undefined, () => {
    storage.removeItem(EMOJI_RECENTS_KEY);
  });
}
