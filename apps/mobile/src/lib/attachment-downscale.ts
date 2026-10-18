/**
 * Over 2048 px on the longest side or 1.5 MB is re-encoded to a 2048 px JPEG at 85 %; GIFs, transparent PNGs and videos pass through.
 */

import { Effect, type Effect as EffectType } from 'effect';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat, type Action, type ImageResult } from 'expo-image-manipulator';

import type { PickedFile } from './attachment-ports';

export const DOWNSCALE_MAX_SIDE = 2048;

export const DOWNSCALE_MAX_BYTES = Math.round(1.5 * 1024 * 1024);

export const DOWNSCALE_QUALITY = 0.85;

export interface DownscaleSizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

export interface ImageDownscaler {
  downscale(file: PickedFile): Promise<PickedFile>;
}

export function longestSide(file: Pick<PickedFile, 'width' | 'height'>): number | undefined {
  if (file.width === undefined || file.height === undefined) {
    return undefined;
  }
  return Math.max(file.width, file.height);
}

/**
 * PNGs under 1.5 MB are skipped whole: they may carry transparency, which JPEG would drop.
 */
export function shouldDownscale(file: PickedFile): boolean {
  const mime = (file.mimeType ?? '').toLowerCase();
  if (!mime.startsWith('image/') || mime === 'image/gif') {
    return false;
  }
  const overBytes = file.size !== undefined && file.size > DOWNSCALE_MAX_BYTES;
  if (mime === 'image/png' && !overBytes) {
    return false;
  }
  const side = longestSide(file);
  return overBytes || (side !== undefined && side > DOWNSCALE_MAX_SIDE);
}

function resizeActions(file: PickedFile): Action[] {
  const side = longestSide(file);
  if (side === undefined || side <= DOWNSCALE_MAX_SIDE) {
    return [];
  }
  return file.width !== undefined && file.height !== undefined && file.width >= file.height
    ? [{ resize: { width: DOWNSCALE_MAX_SIDE } }]
    : [{ resize: { height: DOWNSCALE_MAX_SIDE } }];
}

export function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}

export function createDownscaleSizeReader(
  getInfo: typeof LegacyFileSystem.getInfoAsync = LegacyFileSystem.getInfoAsync,
): DownscaleSizeReader {
  return {
    sizeOf: (uri: string): Promise<number | undefined> =>
      Effect.runPromise(
        Effect.tryPromise({ try: () => getInfo(uri), catch: () => undefined }).pipe(
          Effect.map((info) =>
            info.exists === true && info.isDirectory === false ? info.size : undefined,
          ),
          Effect.orElseSucceed((): number | undefined => undefined),
        ),
      ),
  };
}

/**
 * A transcode failure falls back to the original file, never an error.
 */
const downscaleEffect = Effect.fnUntraced(function* (
  file: PickedFile,
  sizeReader: DownscaleSizeReader,
): EffectType.fn.Return<PickedFile> {
  const result = yield* Effect.tryPromise({
    try: () =>
      manipulateAsync(file.uri, resizeActions(file), {
        compress: DOWNSCALE_QUALITY,
        format: SaveFormat.JPEG,
      }),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed((): ImageResult | undefined => undefined));
  if (result === undefined) {
    return file;
  }
  const size = yield* Effect.tryPromise({
    try: () => sizeReader.sizeOf(result.uri),
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed((): number | undefined => undefined));
  return {
    uri: result.uri,
    name: jpegName(file.name),
    mimeType: 'image/jpeg',
    ...(size === undefined ? {} : { size }),
    width: result.width,
    height: result.height,
  };
});

/**
 * A transcode failure falls back to the original file.
 */
export function createImageDownscaler(options?: {
  sizeReader?: DownscaleSizeReader | undefined;
}): ImageDownscaler {
  const sizeReader = options?.sizeReader ?? createDownscaleSizeReader();
  return {
    downscale: (file: PickedFile): Promise<PickedFile> =>
      shouldDownscale(file)
        ? Effect.runPromise(downscaleEffect(file, sizeReader))
        : Promise.resolve(file),
  };
}
