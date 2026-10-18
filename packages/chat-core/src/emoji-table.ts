// The glyph table itself is generated from unicode-emoji-json by `scripts/gen-emoji.mjs`.

export type EmojiCategoryId =
  | 'smileys'
  | 'people'
  | 'animals'
  | 'food'
  | 'travel'
  | 'activities'
  | 'objects'
  | 'symbols'
  | 'flags';

export interface EmojiCategory {
  id: EmojiCategoryId;
  label: string;
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { id: 'smileys', label: 'Smileys' },
  { id: 'people', label: 'People' },
  { id: 'animals', label: 'Animals' },
  { id: 'food', label: 'Food' },
  { id: 'travel', label: 'Travel' },
  { id: 'activities', label: 'Activities' },
  { id: 'objects', label: 'Objects' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'flags', label: 'Flags' },
] as const;

export { EMOJI_BY_CATEGORY } from './emoji-table.generated';
