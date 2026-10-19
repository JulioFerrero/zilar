import { Effect } from 'effect';

export interface CaretSelection {
  start: number;
  end: number;
}

/**
 * Inserts at the caret, replacing a selection, or appends with no known selection; out-of-range selections clamp.
 */
export function insertEmojiAtCaret(
  text: string,
  emoji: string,
  selection: CaretSelection | undefined,
): { text: string; caret: number } {
  if (selection === undefined) {
    return { text: `${text}${emoji}`, caret: text.length + emoji.length };
  }
  const start = Math.min(Math.max(selection.start, 0), text.length);
  const end = Math.min(Math.max(selection.end, start), text.length);
  const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
  return { text: next, caret: start + emoji.length };
}

export const MAX_RECENT_EMOJI = 24;

/**
 * Most recent first, deduplicated; the caller persists the returned list.
 */
export function rememberRecentEmoji(recents: readonly string[], emoji: string): string[] {
  return [emoji, ...recents.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJI);
}

const parseStoredJson = (raw: string): Effect.Effect<unknown> =>
  Effect.try({ try: () => JSON.parse(raw) as unknown, catch: () => undefined }).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  );

export function readRecentEmoji(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') {
    return [];
  }
  const parsed = Effect.runSync(parseStoredJson(raw));
  if (!Array.isArray(parsed)) {
    return [];
  }
  const recents: string[] = [];
  for (const item of parsed.slice(0, MAX_RECENT_EMOJI)) {
    if (typeof item === 'string' && item !== '' && item.length <= 16) {
      recents.push(item);
    }
  }
  return recents;
}

import { createMemoryRecentsBackend, type RecentsStorageBackend } from './stickers-storage';

let emojiBackend: RecentsStorageBackend = createMemoryRecentsBackend();

export const EMOJI_RECENTS_STORAGE = {
  read: (): Promise<string | null> => emojiBackend.read(),
  write: (raw: string): Promise<void> => emojiBackend.write(raw),
};

const readStoredEmojiRecentsEffect = (): Effect.Effect<string[]> =>
  Effect.tryPromise({ try: () => emojiBackend.read(), catch: () => undefined }).pipe(
    Effect.flatMap((raw) =>
      Effect.try({ try: () => readRecentEmoji(raw), catch: () => undefined }),
    ),
    Effect.catch(() => Effect.succeed<string[]>([])),
  );

export function readStoredEmojiRecents(): Promise<string[]> {
  return Effect.runPromise(readStoredEmojiRecentsEffect());
}

const persistEmojiRecentEffect = (
  storage: Pick<RecentsStorageBackend, 'write'>,
  recents: readonly string[],
  emoji: string,
): Effect.Effect<string[]> =>
  Effect.sync(() => rememberRecentEmoji(recents, emoji)).pipe(
    Effect.flatMap((next) =>
      Effect.tryPromise({
        try: () => storage.write(JSON.stringify(next)),
        catch: () => undefined,
      }).pipe(
        // A blocked storage must never break typing.
        Effect.catch(() => Effect.void),
        Effect.as(next),
      ),
    ),
  );

/**
 * A failing storage never breaks typing.
 */
export function persistEmojiRecent(
  storage: Pick<RecentsStorageBackend, 'write'>,
  recents: readonly string[],
  emoji: string,
): Promise<string[]> {
  return Effect.runPromise(persistEmojiRecentEffect(storage, recents, emoji));
}
