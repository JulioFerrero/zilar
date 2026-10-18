/** The tile size of the favorites grid: 4 columns inside the shell padding. */
export function favoriteTileSize(windowWidth: number): number {
  return Math.floor((windowWidth - 32 - 24) / 4);
}

export function packCountLabel(count: number): string {
  return count === 1 ? '1 sticker' : `${count} stickers`;
}
