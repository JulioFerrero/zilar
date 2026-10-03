import { describe, expect, it } from 'vitest';
import {
  AVATAR_CROP_VIEW_SIDE,
  AVATAR_EXPORT_SIDE,
  clampOffset,
  clampZoom,
  cropRectFor,
  exportDrawArgs,
  fitInView,
} from './avatar-crop';

describe('fitInView', () => {
  it('fits a wide image by its width', () => {
    expect(fitInView({ width: 800, height: 400 })).toEqual({ width: 320, height: 160 });
  });

  it('fits a tall image by its height', () => {
    expect(fitInView({ width: 400, height: 800 })).toEqual({ width: 160, height: 320 });
  });

  it('leaves a square image at the full view side', () => {
    expect(fitInView({ width: 100, height: 100 })).toEqual({
      width: AVATAR_CROP_VIEW_SIDE,
      height: AVATAR_CROP_VIEW_SIDE,
    });
  });
});

describe('clampZoom', () => {
  it('keeps 1 to 4 and repairs garbage', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('clampOffset', () => {
  it('locks the fitted axis at 0 and frees the slack axis', () => {
    // 800x400 fitted to 320x160: the height exactly fills the view, so Y
    // locks; X has 80 px of slack on each side at zoom 1.
    expect(
      clampOffset({ width: 800, height: 400 }, { zoom: 1, offsetX: 500, offsetY: 40 }),
    ).toEqual({ offsetX: 0, offsetY: 0 });
  });

  it('grows the slack with the zoom', () => {
    // At zoom 2 the 320x160 image is 640x320: X slack is 160, Y slack 0.
    expect(
      clampOffset({ width: 800, height: 400 }, { zoom: 2, offsetX: 160, offsetY: 10 }),
    ).toEqual({ offsetX: 160, offsetY: 0 });
    expect(clampOffset({ width: 800, height: 400 }, { zoom: 2, offsetX: 161, offsetY: 0 })).toEqual(
      { offsetX: 160, offsetY: 0 },
    );
  });
});

describe('cropRectFor', () => {
  it('exports the whole square image at zoom 1', () => {
    const rect = cropRectFor({ width: 400, height: 400 }, { zoom: 1, offsetX: 0, offsetY: 0 });
    expect(rect.sourceSide).toBeCloseTo(400, 6);
    expect(rect.sourceX).toBeCloseTo(0, 6);
    expect(rect.sourceY).toBeCloseTo(0, 6);
  });

  it('exports the centred square of a wide image at zoom 1', () => {
    const rect = cropRectFor({ width: 800, height: 400 }, { zoom: 1, offsetX: 0, offsetY: 0 });
    expect(rect.sourceSide).toBeCloseTo(400, 6);
    expect(rect.sourceX).toBeCloseTo(200, 6);
    expect(rect.sourceY).toBeCloseTo(0, 6);
  });

  it('zooms into half the side at zoom 2', () => {
    const rect = cropRectFor({ width: 400, height: 400 }, { zoom: 2, offsetX: 0, offsetY: 0 });
    expect(rect.sourceSide).toBeCloseTo(200, 6);
    expect(rect.sourceX).toBeCloseTo(100, 6);
    expect(rect.sourceY).toBeCloseTo(100, 6);
  });

  it('follows the drag offset and stays in bounds', () => {
    const rect = cropRectFor({ width: 800, height: 400 }, { zoom: 2, offsetX: 80, offsetY: 0 });
    expect(rect.sourceX).toBeLessThan(200);
    expect(rect.sourceX).toBeGreaterThanOrEqual(0);
    expect(rect.sourceX + rect.sourceSide).toBeLessThanOrEqual(800);
    expect(rect.sourceY + rect.sourceSide).toBeLessThanOrEqual(400);
  });

  it('never leaves the source, even at extreme zoom and offset', () => {
    const rect = cropRectFor({ width: 300, height: 500 }, { zoom: 4, offsetX: 999, offsetY: -999 });
    expect(rect.sourceX).toBeGreaterThanOrEqual(0);
    expect(rect.sourceY).toBeGreaterThanOrEqual(0);
    expect(rect.sourceX + rect.sourceSide).toBeLessThanOrEqual(300);
    expect(rect.sourceY + rect.sourceSide).toBeLessThanOrEqual(500);
  });
});

describe('exportDrawArgs', () => {
  it('paints the crop square onto the 256 px canvas', () => {
    const args = exportDrawArgs({ width: 800, height: 400 }, { zoom: 1, offsetX: 0, offsetY: 0 });
    expect(args.dSide).toBe(AVATAR_EXPORT_SIDE);
    expect(args.sSide).toBeCloseTo(400, 6);
    expect(args.sx).toBeCloseTo(200, 6);
    expect(args.sy).toBeCloseTo(0, 6);
  });
});
