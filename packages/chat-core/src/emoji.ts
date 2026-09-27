import { graphemes } from './text';

/**
 * A single emoji grapheme: a pictograph (with an optional variation selector
 * and skin-tone modifier), a regional-indicator flag pair, or a ZWJ sequence of
 * those. Keycaps and other digit-based sequences deliberately do not match.
 */
const EMOJI_GRAPHEME =
  /^(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?|\p{Regional_Indicator}{2})(?:\u200D(?:\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?|\p{Regional_Indicator}{2}))*$/u;

const MAX_BIG_EMOJI = 3;

/**
 * True when the text is nothing but one to three emoji graphemes. Text, digits,
 * keycaps and mixed content are not big emoji. Graphemes come from
 * `Intl.Segmenter`, so a flag or a ZWJ family counts as one emoji.
 */
export function isBigEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const parts = graphemes(trimmed);
  if (parts.length === 0 || parts.length > MAX_BIG_EMOJI) {
    return false;
  }
  return parts.every((part) => EMOJI_GRAPHEME.test(part));
}
