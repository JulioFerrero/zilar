/**
 * The picked-photo downscale (T-1246, Telegram parity item 10, step 1): a
 * phone photo over 2048 px on its longest side or over 1.5 MB is re-encoded
 * to a 2048 px JPEG at 85 % before the upload. GIFs, sidecar transparency
 * (all PNGs under 1.5 MB) and videos pass through untouched, and a failure
 * falls back to the original file, never an error.
 */

import { Effect, type Effect as EffectType } from 'effect';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat, type Action, type ImageResult } from 'expo-image-manipulator';

import type { PickedFile } from './attachment-ports';

/** The longest side the downscale keeps, in pixels. */
export const DOWNSCALE_MAX_SIDE = 2048;

/** The byte size that triggers the downscale for an otherwise small image. */
export const DOWNSCALE_MAX_BYTES = Math.round(1.5 * 1024 * 1024);

/** The JPEG quality the downscale writes. */
export const DOWNSCALE_QUALITY = 0.85;

/** Resolves the real byte size of a local file, or undefined when unknown. */
export interface DownscaleSizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

/** Re-encodes one picked image, or returns it unchanged when it needs no work. */
export interface ImageDownscaler {
  downscale(file: PickedFile): Promise<PickedFile>;
}

/** The longest side of an asset whose dimensions are known. */
export function longestSide(file: Pick<PickedFile, 'width' | 'height'>): number | undefined {
  if (file.width === undefined || file.height === undefined) {
    return undefined;
  }
  return Math.max(file.width, file.height);
}

/**
 * Whether an image needs the downscale: an image that is not a GIF, over
 * 2048 px on its longest side or over 1.5 MB. PNGs under 1.5 MB are skipped
 * whole (they may carry transparency, which JPEG would drop); videos and
 * unknown types are never images here.
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

/** The resize action that caps the longest side, or none when it already fits. */
function resizeActions(file: PickedFile): Action[] {
  const side = longestSide(file);
  if (side === undefined || side <= DOWNSCALE_MAX_SIDE) {
    return [];
  }
  return file.width !== undefined && file.height !== undefined && file.width >= file.height
    ? [{ resize: { width: DOWNSCALE_MAX_SIDE } }]
    : [{ resize: { height: DOWNSCALE_MAX_SIDE } }];
}

/** The file name with its extension replaced by `.jpg` (added when absent). */
export function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}

/** The real size reader: `expo-file-system` stat of the re-encoded file. */
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
 * One downscale as an Effect: transcode with `expo-image-manipulator` (JPEG,
 * 85 %, longest side capped), read the new size, and fall back to the original
 * file when the transcode fails.
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
 * The real downscaler: skips files that need no work, otherwise re-encodes a
 * 2048 px JPEG at 85 %. A transcode failure falls back to the original file.
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
