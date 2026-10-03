/**
 * Emoji data for the mobile emoji panel (T-0175): a dependency-free list of
 * common emoji grouped by category (plain Unicode strings, no images), plus
 * the pure helpers the panel and the composer use (caret insertion, recents).
 */

export type EmojiCategoryId =
  | 'smileys'
  | 'people'
  | 'hearts'
  | 'animals'
  | 'food'
  | 'activities'
  | 'travel'
  | 'objects'
  | 'symbols';

export interface EmojiCategory {
  id: EmojiCategoryId;
  label: string;
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { id: 'smileys', label: 'Smileys' },
  { id: 'people', label: 'People' },
  { id: 'hearts', label: 'Hearts' },
  { id: 'animals', label: 'Animals' },
  { id: 'food', label: 'Food' },
  { id: 'activities', label: 'Activities' },
  { id: 'travel', label: 'Travel' },
  { id: 'objects', label: 'Objects' },
  { id: 'symbols', label: 'Symbols' },
] as const;

export const EMOJI_BY_CATEGORY: Record<EmojiCategoryId, readonly string[]> = {
  smileys: [
    '😀',
    '😃',
    '😄',
    '😁',
    '😆',
    '😅',
    '🤣',
    '😂',
    '🙂',
    '🙃',
    '😉',
    '😊',
    '😇',
    '🥰',
    '😍',
    '🤩',
    '😘',
    '😗',
    '😚',
    '😙',
    '😋',
    '😛',
    '😜',
    '🤪',
    '😝',
    '🤑',
    '🤗',
    '🤭',
    '🤫',
    '🤔',
    '😐',
    '😑',
    '😶',
    '🙄',
    '😏',
    '😬',
    '😴',
    '🤤',
    '😪',
    '😷',
    '🤒',
    '🤕',
    '🤢',
    '🤮',
    '🤧',
    '🥵',
    '🥶',
    '🥴',
  ],
  people: [
    '👋',
    '🤚',
    '🖐',
    '✋',
    '🖖',
    '👌',
    '🤌',
    '✌️',
    '🤞',
    '🤟',
    '🤘',
    '🤙',
    '👈',
    '👉',
    '👆',
    '👇',
    '☝️',
    '👍',
    '👎',
    '✊',
    '👊',
    '🤛',
    '🤜',
    '👏',
    '🙌',
    '👐',
    '🤲',
    '🤝',
    '🙏',
    '💪',
    '👶',
    '👧',
  ],
  hearts: [
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🖤',
    '🤍',
    '🤎',
    '💔',
    '❣️',
    '💕',
    '💞',
    '💓',
    '💗',
    '💖',
    '💘',
    '💝',
    '💟',
    '♥️',
  ],
  animals: [
    '🐶',
    '🐱',
    '🐭',
    '🐹',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐸',
    '🐵',
    '🙈',
    '🙉',
    '🙊',
    '🐔',
    '🐧',
    '🐦',
    '🐤',
    '🦆',
    '🦅',
    '🦉',
    '🐺',
    '🐴',
    '🦄',
    '🐝',
    '🦋',
  ],
  food: [
    '🍎',
    '🍐',
    '🍊',
    '🍋',
    '🍌',
    '🍉',
    '🍇',
    '🍓',
    '🫐',
    '🍒',
    '🍑',
    '🥭',
    '🍍',
    '🥝',
    '🍅',
    '🥑',
    '🥕',
    '🌽',
    '🌶',
    '🥒',
    '🍕',
    '🍔',
    '🍟',
    '🌭',
    '🍿',
    '🍩',
    '🍪',
    '☕',
  ],
  activities: [
    '⚽',
    '🏀',
    '🏈',
    '⚾',
    '🎾',
    '🏐',
    '🎱',
    '🏓',
    '🏸',
    '🥅',
    '⛳',
    '🏹',
    '🎣',
    '🥊',
    '🎽',
    '🏋️',
    '🚴',
    '🤸',
    '⛷',
    '🏂',
    '🏆',
    '🥇',
    '🥈',
    '🥉',
    '🎮',
    '🎲',
  ],
  travel: [
    '🚗',
    '🚕',
    '🚙',
    '🚌',
    '🏎',
    '🚓',
    '🚑',
    '🚒',
    '🚚',
    '🚜',
    '✈️',
    '🚀',
    '🚁',
    '🚂',
    '🚇',
    '🚲',
    '🛵',
    '🏍',
    '⛵',
    '🚤',
    '🗺',
    '🧳',
    '⛺',
    '🗽',
    '🗼',
    '🏝',
  ],
  objects: [
    '⌚',
    '📱',
    '💻',
    '⌨️',
    '🖥',
    '🖱',
    '💽',
    '💾',
    '📷',
    '📹',
    '📞',
    '📺',
    '📻',
    '⏰',
    '⌛',
    '📡',
    '🔋',
    '🔌',
    '💡',
    '🔦',
    '💸',
    '💵',
    '💰',
    '🔑',
    '🔨',
    '🧲',
    '🎁',
    '🎈',
    '📚',
    '✏️',
  ],
  symbols: [
    '0️⃣',
    '1️⃣',
    '2️⃣',
    '3️⃣',
    '4️⃣',
    '5️⃣',
    '6️⃣',
    '7️⃣',
    '8️⃣',
    '9️⃣',
    '🔟',
    '#️⃣',
    '*️⃣',
    '▶️',
    '⏸',
    '⏯',
    '🔀',
    '🔁',
    '➡️',
    '⬅️',
    '⬆️',
    '⬇️',
    '➕',
    '➖',
    '✖️',
    '‼️',
  ],
};

/** The composer's caret: the TextInput `onSelectionChange` selection. */
export interface CaretSelection {
  start: number;
  end: number;
}

/**
 * Inserts an emoji at the caret, replacing any selected range; with no known
 * selection it appends at the end. Returns the next text and the caret just
 * after the inserted emoji. Out-of-range selections clamp to the text.
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

/** How many used emoji the Recent row keeps (T-0175). */
export const MAX_RECENT_EMOJI = 24;

/**
 * Records a picked emoji first (deduplicated, most recent first); the caller
 * persists the returned list. Mirrors `rememberRecentSticker`.
 */
export function rememberRecentEmoji(recents: readonly string[], emoji: string): string[] {
  return [emoji, ...recents.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJI);
}

/** Reads stored emoji recents; hostile or missing data resolves to []. */
export function readRecentEmoji(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
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

/** The device key for emoji recents (kept next to the sticker recents). */
export const EMOJI_RECENTS_KEY = 'zilar:recentEmoji';

let emojiBackend: RecentsStorageBackend = createMemoryRecentsBackend();

/** Swaps the emoji recents backend (tests and the app's persisted store). */
export function setEmojiRecentsBackend(next: RecentsStorageBackend): void {
  emojiBackend = next;
}

/** The emoji recents storage the composer hands to the emoji panel. */
export const EMOJI_RECENTS_STORAGE = {
  read: (): Promise<string | null> => emojiBackend.read(),
  write: (raw: string): Promise<void> => emojiBackend.write(raw),
};

/** Reads the emoji recents; hostile or missing data resolves to []. */
export async function readStoredEmojiRecents(): Promise<string[]> {
  try {
    return readRecentEmoji(await emojiBackend.read());
  } catch {
    return [];
  }
}

/**
 * Records a picked emoji in per-device recents; a failing storage never
 * breaks typing.
 */
export async function persistEmojiRecent(
  storage: Pick<RecentsStorageBackend, 'write'>,
  recents: readonly string[],
  emoji: string,
): Promise<string[]> {
  const next = rememberRecentEmoji(recents, emoji);
  try {
    await storage.write(JSON.stringify(next));
  } catch {
    // A blocked storage must never break typing.
  }
  return next;
}
