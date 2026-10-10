/** The longest side a sticker is prepared at before upload. */
export const STICKER_PREP_MAX_DIM = 512;

/** Fits a size inside 512 x 512 keeping the ratio; small images stay as-is. */
export function fitStickerSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= STICKER_PREP_MAX_DIM) {
    return { width, height };
  }
  const scale = STICKER_PREP_MAX_DIM / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
