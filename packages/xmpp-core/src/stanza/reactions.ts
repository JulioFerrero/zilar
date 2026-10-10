export const CHAT_STATES: ReadonlyArray<'composing' | 'paused' | 'active'> = [
  'composing',
  'paused',
  'active',
];

// XEP-0372 references are capped so a hostile message cannot force unbounded
// work or memory.
export const MAX_MENTIONS = 20;

// XEP-0444: a reaction is one emoji grapheme of at most eight code points, and
// a reactor may hold at most six distinct reactions on one message.
const MAX_REACTIONS = 6;
const MAX_REACTION_CODE_POINTS = 8;
const EMOJI_GRAPHEME =
  /^(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?|\p{Regional_Indicator}{2})(?:\u200D(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?|\p{Regional_Indicator}{2}))*$/u;

function isReactionEmoji(value: string): boolean {
  const codePoints = Array.from(value).length;
  return codePoints >= 1 && codePoints <= MAX_REACTION_CODE_POINTS && EMOJI_GRAPHEME.test(value);
}

// Keeps only valid, distinct reactions in first-seen order, capped at six. Used
// on both sides so a hostile or buggy peer cannot make us store or send junk.
export function sanitizeReactions(emojis: readonly string[]): string[] {
  const result: string[] = [];
  for (const emoji of emojis) {
    if (result.length >= MAX_REACTIONS) break;
    if (!isReactionEmoji(emoji) || result.includes(emoji)) continue;
    result.push(emoji);
  }
  return result;
}

export type ReplyRef = { id: string; to?: string };

// XEP-0372 counts offsets in Unicode code points, while JS strings are UTF-16.
// The helpers convert one unit into the other across a body. `Array.from` on a
// string counts code points (a surrogate pair is one entry).
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function codePointOffset(text: string, utf16Index: number): number {
  return codePointLength(text.slice(0, utf16Index));
}

export function utf16Offset(text: string, codePointIndex: number): number {
  let index = 0;
  let count = 0;
  for (const character of text) {
    if (count >= codePointIndex) {
      return index;
    }
    index += character.length;
    count += 1;
  }
  return index;
}
