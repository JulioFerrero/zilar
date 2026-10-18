export const STICKER_PREP_MAX_DIM = 512;

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
