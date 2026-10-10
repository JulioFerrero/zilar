/**
 * The small pure helpers of the Settings Stickers screen (T-0996): the
 * favorites tile size and the sticker count label.
 */

/** The tile size of the favorites grid: 4 columns inside the shell padding. */
export function favoriteTileSize(windowWidth: number): number {
  return Math.floor((windowWidth - 32 - 24) / 4);
}

/** The sticker count under a pack title. */
export function packCountLabel(count: number): string {
  return count === 1 ? '1 sticker' : `${count} stickers`;
}
