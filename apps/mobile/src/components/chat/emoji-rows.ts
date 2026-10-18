/**
 * T-1946: the Emoji tab's single continuous list. The panel renders one
 * `FlatList` over every category, with a header per section, so a scroll runs
 * from Recently used through all nine categories and the category bar can
 * follow it.
 */

import { EMOJI_BY_CATEGORY, EMOJI_CATEGORIES, type EmojiCategoryId } from '@/lib/emoji-data';

/** A header's category; `recent` comes first when the device has recents. */
export type EmojiSectionCategory = 'recent' | EmojiCategoryId;

export interface EmojiHeaderItem {
  kind: 'header';
  key: string;
  category: EmojiSectionCategory;
  label: string;
}

export interface EmojiRowItem {
  kind: 'row';
  key: string;
  /** Absent on search results, which have no category section. */
  category?: EmojiSectionCategory;
  glyphs: string[];
}

export type EmojiListItem = EmojiHeaderItem | EmojiRowItem;

export interface EmojiRows {
  items: EmojiListItem[];
  /** The index of each section's header in `items`. */
  headerIndex: Partial<Record<EmojiSectionCategory, number>>;
}

/** Splits glyphs into rows of `columns` cells; the last row may be shorter. */
function chunk<T>(items: readonly T[], columns: number): T[][] {
  if (columns <= 0) {
    return [];
  }
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += columns) {
    rows.push(items.slice(start, start + columns));
  }
  return rows;
}

/**
 * Builds the continuous Emoji list: a header and its glyph rows per category,
 * Recently used first when non-empty, then the nine categories in table order.
 */
export function buildEmojiRows(recents: readonly string[], columns: number): EmojiRows {
  const items: EmojiListItem[] = [];
  const headerIndex: Partial<Record<EmojiSectionCategory, number>> = {};

  const addSection = (
    category: EmojiSectionCategory,
    label: string,
    glyphs: readonly string[],
  ): void => {
    if (glyphs.length === 0) {
      return;
    }
    headerIndex[category] = items.length;
    items.push({ kind: 'header', key: `header-${category}`, category, label });
    chunk(glyphs, columns).forEach((row, rowIndex) => {
      items.push({
        kind: 'row',
        key: `${category}-row-${rowIndex}`,
        category,
        glyphs: row,
      });
    });
  };

  addSection('recent', 'Recently used', recents);
  for (const category of EMOJI_CATEGORIES) {
    addSection(category.id, category.label, EMOJI_BY_CATEGORY[category.id]);
  }

  return { items, headerIndex };
}

/** Builds the search results as glyph rows only, without category headers. */
export function buildSearchRows(results: readonly string[], columns: number): EmojiRowItem[] {
  return chunk(results, columns).map((glyphs, index) => ({
    kind: 'row',
    key: `search-row-${index}`,
    glyphs,
  }));
}
