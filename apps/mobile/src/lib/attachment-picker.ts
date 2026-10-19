import { Effect, type Effect as EffectType } from 'effect';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { manipulateAsync, SaveFormat, type Action, type ImageResult } from 'expo-image-manipulator';

import {
  extensionForMime,
  MAX_ATTACHMENT_BYTES,
  mimeForAsset,
  mimeForFileName,
} from './attachments';
import type { AttachmentPicker, PickedFile, PickResult } from './attachment-ports';
import {
  CAMERA_DENIED_MESSAGE,
  DENIED_MESSAGE,
  EMPTY_MESSAGE,
  NativeFailure,
  orErrorResult,
  PICK_FAILED_MESSAGE,
  TOO_LARGE_MESSAGE,
} from './attachment-common';

function tooLarge(size: number | undefined): boolean {
  return size !== undefined && size > MAX_ATTACHMENT_BYTES;
}

/**
 * Shared by the library pick and the gallery grid, so both refuse the same files with the same sentence.
 */
function sizeErrorMessage(size: number | undefined): string | undefined {
  if (size !== undefined && size === 0) {
    return EMPTY_MESSAGE;
  }
  return tooLarge(size) ? TOO_LARGE_MESSAGE : undefined;
}

function pickedFile(input: {
  uri: string;
  name: string | null | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  measuredSize?: number | undefined;
}): PickResult {
  // An unknown picker size is not empty: only a real zero refuses (the size is read from the file first).
  const size = input.size ?? input.measuredSize;
  const sizeError = sizeErrorMessage(size);
  if (sizeError !== undefined) {
    return { status: 'error', message: sizeError };
  }
  const mime = mimeForAsset(input.mimeType);
  const fallbackName = `photo.${extensionForMime(mime)}`;
  // Never coerce to 0: the send layer must see unknown as unknown.
  const file: PickedFile = {
    uri: input.uri,
    name: input.name ?? fallbackName,
    mimeType: mime,
    ...(size === undefined ? {} : { size }),
  };
  if (input.width !== undefined && input.height !== undefined) {
    file.width = input.width;
    file.height = input.height;
  }
  return { status: 'picked', file, files: [file] };
}

interface AssetInput {
  uri: string;
  name: string | null | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

function assetInputFor(asset: ImagePicker.ImagePickerAsset): AssetInput {
  const mime = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
  const name = asset.fileName ?? `photo.${extensionForMime(mime)}`;
  return {
    uri: asset.uri,
    name,
    mimeType: mime,
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
  };
}

export function createAttachmentPicker(sizeReader?: SizeReader): AttachmentPicker {
  const reader = sizeReader ?? createSizeReader();
  const downscaler = createImageDownscaler({ sizeReader: reader });
  // Read the real size before the cap check: only a real zero says "That file is empty".
  const withRealSize = (input: AssetInput): Effect.Effect<PickResult> =>
    input.size !== undefined
      ? Effect.succeed(pickedFile(input))
      : Effect.promise(() => reader.sizeOf(input.uri)).pipe(
          Effect.map((measuredSize) => pickedFile({ ...input, measuredSize })),
        );

  // One failing file fails the whole pick; the rest stage with their downscaled bytes and dimensions.
  const pickedFromAssets = (assets: readonly AssetInput[]): Effect.Effect<PickResult> =>
    Effect.forEach(assets, withRealSize, { concurrency: 'unbounded' }).pipe(
      Effect.flatMap((results) => {
        const failed = results.find((result) => result.status === 'error');
        if (failed !== undefined) {
          return Effect.succeed<PickResult>(failed);
        }
        const files = results.flatMap((result) =>
          result.status === 'picked' ? [result.file] : [],
        );
        if (files.length === 0) {
          return Effect.succeed<PickResult>({ status: 'cancelled' });
        }
        return Effect.promise(() =>
          Promise.all(files.map((file) => downscaler.downscale(file))),
        ).pipe(
          Effect.map((next): PickResult => {
            const file = next[0];
            if (file === undefined) {
              return { status: 'cancelled' };
            }
            return { status: 'picked', file, files: next };
          }),
        );
      }),
    );

  const pickImageOrVideoEffect = Effect.fnUntraced(function* (): EffectType.fn.Return<
    PickResult,
    NativeFailure
  > {
    const permission = yield* Effect.promise(() =>
      ImagePicker.requestMediaLibraryPermissionsAsync(),
    );
    if (!permission.granted) {
      return { status: 'error', message: DENIED_MESSAGE };
    }
    const result = yield* Effect.tryPromise({
      try: () =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          quality: 1,
          allowsMultipleSelection: true,
          selectionLimit: 10,
        }),
      catch: () => new NativeFailure({ message: PICK_FAILED_MESSAGE }),
    });
    if (result.canceled || result.assets.length === 0) {
      return { status: 'cancelled' };
    }
    return yield* pickedFromAssets(result.assets.map(assetInputFor));
  });

  const takePhotoEffect = Effect.fnUntraced(function* (): EffectType.fn.Return<
    PickResult,
    NativeFailure
  > {
    const permission = yield* Effect.promise(() => ImagePicker.requestCameraPermissionsAsync());
    if (!permission.granted) {
      return { status: 'error', message: CAMERA_DENIED_MESSAGE };
    }
    const result = yield* Effect.tryPromise({
      try: () => ImagePicker.launchCameraAsync({ quality: 1 }),
      catch: () => new NativeFailure({ message: PICK_FAILED_MESSAGE }),
    });
    if (result.canceled) {
      return { status: 'cancelled' };
    }
    const asset = result.assets[0];
    if (asset === undefined) {
      return { status: 'cancelled' };
    }
    return yield* pickedFromAssets([assetInputFor(asset)]);
  });

  const pickFileEffect = Effect.fnUntraced(function* (): EffectType.fn.Return<
    PickResult,
    NativeFailure
  > {
    const result = yield* Effect.tryPromise({
      try: () => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true }),
      catch: () => new NativeFailure({ message: PICK_FAILED_MESSAGE }),
    });
    if (result.canceled) {
      return { status: 'cancelled' };
    }
    const assets = result.assets;
    if (assets.length === 0) {
      return { status: 'cancelled' };
    }
    // Documents get the same size read and rules as a library pick, so several stage together.
    return yield* pickedFromAssets(
      assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      })),
    );
  });

  return {
    pickImageOrVideo: () => Effect.runPromise(orErrorResult(pickImageOrVideoEffect())),
    takePhoto: () => Effect.runPromise(orErrorResult(takePhotoEffect())),
    pickFile: () => Effect.runPromise(orErrorResult(pickFileEffect())),
  };
}

export interface GalleryPage {
  assets: GalleryAsset[];
  endCursor: string;
  hasNextPage: boolean;
}

export interface GalleryAsset {
  id: string;
  /** Display URI: `ph://*` on iOS, `file://*` on Android. */
  uri: string;
  filename: string;
  mediaType: 'photo' | 'video';
  width: number;
  height: number;
  /** Seconds for a video, 0 for a photo. */
  duration: number;
}

/**
 * The `ph://` display URI is not uploadable, so `toPickedFile` resolves a local `file://` URI and applies the same size and downscale rules as a library pick.
 */
export type GalleryPickResult =
  { status: 'picked'; file: PickedFile } | { status: 'error'; message: string };

export interface GalleryReader {
  requestPermission(): Promise<boolean>;
  loadPage(input: { after?: string | undefined; pageSize: number }): Promise<GalleryPage>;
  toPickedFile(asset: GalleryAsset): Promise<GalleryPickResult>;
}

function galleryAssetFor(asset: MediaLibrary.Asset): GalleryAsset {
  return {
    id: asset.id,
    uri: asset.uri,
    filename: asset.filename,
    mediaType: asset.mediaType === 'video' ? 'video' : 'photo',
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  };
}

/**
 * `getAssetInfoAsync` may fail for an iCloud asset; the display URI is then kept, so the grid works and only the upload fails.
 */
export function createGalleryReader(options?: {
  sizeReader?: SizeReader | undefined;
  downscaler?: ImageDownscaler | undefined;
}): GalleryReader {
  const sizeReader = options?.sizeReader ?? createSizeReader();
  const downscaler = options?.downscaler ?? createImageDownscaler({ sizeReader });
  return {
    requestPermission: () =>
      // Photos and videos only, so Android 13+ never asks for audio; the signature is `requestPermissionsAsync(writeOnly?, granularPermissions?)`.
      MediaLibrary.requestPermissionsAsync(false, ['photo', 'video'])
        .then((response) => response.granted)
        .catch(() => false),
    loadPage: async ({ after, pageSize }) => {
      const page = await MediaLibrary.getAssetsAsync({
        first: pageSize,
        mediaType: ['photo', 'video'],
        sortBy: [['creationTime', false]],
        ...(after === undefined ? {} : { after }),
      });
      return {
        assets: page.assets.map(galleryAssetFor),
        endCursor: page.endCursor,
        hasNextPage: page.hasNextPage,
      };
    },
    toPickedFile: async (asset) => {
      const info = await MediaLibrary.getAssetInfoAsync(asset.id).catch(() => undefined);
      const uri = info?.localUri ?? asset.uri;
      const fallback = asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
      const base: PickedFile = {
        uri,
        name: asset.filename,
        mimeType: mimeForFileName(asset.filename, fallback),
        width: asset.width,
        height: asset.height,
      };
      const size = await sizeReader.sizeOf(uri);
      const sizeError = sizeErrorMessage(size);
      if (sizeError !== undefined) {
        return { status: 'error', message: sizeError };
      }
      const file = await downscaler.downscale(size === undefined ? base : { ...base, size });
      return { status: 'picked', file };
    },
  };
}

export interface SizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

export function createSizeReader(
  getInfo: typeof FileSystem.getInfoAsync = FileSystem.getInfoAsync,
): SizeReader {
  return {
    sizeOf: (uri: string): Promise<number | undefined> =>
      Effect.runPromise(
        Effect.tryPromise({ try: () => getInfo(uri), catch: () => undefined }).pipe(
          Effect.map((info) =>
            info.exists === true && info.isDirectory === false ? info.size : undefined,
          ),
          Effect.orElseSucceed((): number | undefined => undefined),
          Effect.catchDefect(() => Effect.succeed<number | undefined>(undefined)),
        ),
      ),
  };
}

/**
 * Over 2048 px on the longest side or 1.5 MB is re-encoded to a 2048 px JPEG at 85 %; GIFs, transparent PNGs and videos pass through.
 */

const DOWNSCALE_MAX_SIDE = 2048;

const DOWNSCALE_MAX_BYTES = Math.round(1.5 * 1024 * 1024);

const DOWNSCALE_QUALITY = 0.85;

interface DownscaleSizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

export interface ImageDownscaler {
  downscale(file: PickedFile): Promise<PickedFile>;
}

function longestSide(file: Pick<PickedFile, 'width' | 'height'>): number | undefined {
  if (file.width === undefined || file.height === undefined) {
    return undefined;
  }
  return Math.max(file.width, file.height);
}

/**
 * PNGs under 1.5 MB are skipped whole: they may carry transparency, which JPEG would drop.
 */
function shouldDownscale(file: PickedFile): boolean {
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

function jpegName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}

function createDownscaleSizeReader(
  getInfo: typeof FileSystem.getInfoAsync = FileSystem.getInfoAsync,
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
function createImageDownscaler(options?: {
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
