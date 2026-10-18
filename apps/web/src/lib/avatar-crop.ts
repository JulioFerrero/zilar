// No DOM here, so the crop math runs in Vitest without a browser.

export const AVATAR_EXPORT_SIDE = 256;
/** The crop dialog's preview box is square; the source fits inside it. */
export const AVATAR_CROP_VIEW_SIDE = 320;
export const AVATAR_MIN_ZOOM = 1;
export const AVATAR_MAX_ZOOM = 4;

export interface CropSource {
  width: number;
  height: number;
}

/** The visible crop area in source-image pixels, as react-easy-crop reports it. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropState {
  crop: { x: number; y: number };
  /** Zoom factor: 1 shows the whole image, higher zooms in. */
  zoom: number;
  /** The visible crop area in source pixels; null until the Cropper reports it. */
  area: CropArea | null;
}

export const INITIAL_CROP_STATE: CropState = { crop: { x: 0, y: 0 }, zoom: 1, area: null };

/** The drawImage arguments that paint the export: the square the Cropper shows, clamped into
 * the source and scaled up; before any area is reported, the largest centred square. */
export function exportDrawArgs(
  source: CropSource,
  state: CropState,
  exportSide: number = AVATAR_EXPORT_SIDE,
): { sx: number; sy: number; sSide: number; dSide: number } {
  const area = state.area;
  const side =
    area === null
      ? Math.max(0, Math.min(source.width, source.height))
      : Math.max(0, Math.min(area.width, area.height, source.width, source.height));
  const x = area === null ? (source.width - side) / 2 : area.x;
  const y = area === null ? (source.height - side) / 2 : area.y;
  const sx = Math.min(Math.max(0, x), Math.max(0, source.width - side));
  const sy = Math.min(Math.max(0, y), Math.max(0, source.height - side));
  return { sx, sy, sSide: side, dSide: exportSide };
}
