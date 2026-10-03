/**
 * Avatar crop maths (T-0165): small pure functions for the `AvatarUploader`
 * crop dialog. The dialog shows the source image under a circular mask with
 * a zoom slider and drag-to-position; these functions map between the dialog
 * state and the canvas export. No DOM here, so tests run in Vitest without
 * a browser.
 */

export const AVATAR_EXPORT_SIDE = 256;
/** The crop dialog's preview box is square; the source fits inside it. */
export const AVATAR_CROP_VIEW_SIDE = 320;

export interface CropSource {
  width: number;
  height: number;
}

export interface CropState {
  /** Zoom factor: 1 shows the whole fitted image, higher zooms in. */
  zoom: number;
  /** Drag offset in view pixels (positive moves the image right/down). */
  offsetX: number;
  offsetY: number;
}

export interface CropRect {
  /** Source-image pixels of the exported square's top-left corner. */
  sourceX: number;
  sourceY: number;
  /** Source-image pixels of the exported square's side. */
  sourceSide: number;
}

/** Fits the source inside the square view, keeping the ratio. */
export function fitInView(
  source: CropSource,
  viewSide: number = AVATAR_CROP_VIEW_SIDE,
): {
  width: number;
  height: number;
} {
  const longest = Math.max(source.width, source.height);
  if (longest <= 0) {
    return { width: viewSide, height: viewSide };
  }
  const scale = viewSide / longest;
  return { width: source.width * scale, height: source.height * scale };
}

/** Clamps the zoom to the usable range: 1 (whole image) to 4. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(4, Math.max(1, zoom));
}

/**
 * Clamps the drag offset so the circular mask (the full view square) never
 * shows the background: the scaled image must cover the view on every
 * side. A fitted image exactly fills one axis, so that axis locks at 0.
 */
export function clampOffset(
  source: CropSource,
  state: CropState,
  viewSide: number = AVATAR_CROP_VIEW_SIDE,
): { offsetX: number; offsetY: number } {
  const fitted = fitInView(source, viewSide);
  const zoom = clampZoom(state.zoom);
  const scaledWidth = fitted.width * zoom;
  const scaledHeight = fitted.height * zoom;
  const clampAxis = (offset: number, scaled: number): number => {
    const slack = Math.max(0, (scaled - viewSide) / 2);
    return Math.min(slack, Math.max(-slack, Number.isFinite(offset) ? offset : 0));
  };
  return {
    offsetX: clampAxis(state.offsetX, scaledWidth),
    offsetY: clampAxis(state.offsetY, scaledHeight),
  };
}

/**
 * Maps the dialog state to the source-image square to export. The crop is
 * the largest square that fits the mask: the view square mapped back
 * through the fit scale and the zoom, centred on the (clamped) offset.
 * The result is clamped into the source bounds.
 */
export function cropRectFor(
  source: CropSource,
  state: CropState,
  viewSide: number = AVATAR_CROP_VIEW_SIDE,
): CropRect {
  const fitted = fitInView(source, viewSide);
  const zoom = clampZoom(state.zoom);
  const { offsetX, offsetY } = clampOffset(source, { ...state, zoom }, viewSide);
  const scale = fitted.width / source.width || 1;
  const side = Math.min(source.width, source.height, viewSide / scale / zoom);
  const centerX = source.width / 2 - offsetX / scale / zoom;
  const centerY = source.height / 2 - offsetY / scale / zoom;
  const sourceX = Math.min(Math.max(0, centerX - side / 2), Math.max(0, source.width - side));
  const sourceY = Math.min(Math.max(0, centerY - side / 2), Math.max(0, source.height - side));
  return { sourceX, sourceY, sourceSide: side };
}

/**
 * The `drawImage` arguments that paint the export: the crop square from
 * `cropRectFor`, scaled to the 256 px export canvas.
 */
export function exportDrawArgs(
  source: CropSource,
  state: CropState,
  exportSide: number = AVATAR_EXPORT_SIDE,
): { sx: number; sy: number; sSide: number; dSide: number } {
  const rect = cropRectFor(source, state);
  return { sx: rect.sourceX, sy: rect.sourceY, sSide: rect.sourceSide, dSide: exportSide };
}
