/**
 * Shared emoji data (T-1673, moved from the phone's `lib/emoji-table.ts`):
 * a dependency-free list of common emoji grouped by category (plain Unicode
 * strings, no images), used by both the web and phone emoji pickers. The
 * glyph table itself is generated from unicode-emoji-json (T-1926); the
 * generator lives in `scripts/gen-emoji.mjs`.
 */

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
