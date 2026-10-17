export const MEDIA_WIDTH = 240;
export const MAX_IMAGE_HEIGHT = 320;
export const MIN_MEDIA_WIDTH = 140;

/** The pixel box of a single photo bubble (T-1924): as wide as the photo at
 *  its ratio, at most 240 x 320, never narrower than 140 (then cropped). */
export function mediaFrame(ratio: number | undefined): { width: number; height: number } {
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) {
    return { width: MEDIA_WIDTH, height: MAX_IMAGE_HEIGHT };
  }
  const height = Math.min(MAX_IMAGE_HEIGHT, MEDIA_WIDTH / ratio);
  const width = Math.min(MEDIA_WIDTH, Math.max(MIN_MEDIA_WIDTH, height * ratio));
  return { width: Math.round(width), height: Math.round(height) };
}
