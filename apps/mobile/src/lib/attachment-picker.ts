/**
 * The real native picker seams (T-1021, split from `attachment-native.ts`):
 * `expo-image-picker` for photos, videos and the camera, and
 * `expo-document-picker` for generic files.
 */

import { Effect, type Effect as EffectType } from 'effect';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';

import {
  extensionForMime,
  MAX_ATTACHMENT_BYTES,
  mimeForAsset,
  mimeForFileName,
} from './attachments';
import { createImageDownscaler, type ImageDownscaler } from './attachment-downscale';
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
 * The fixed message for an empty (real zero bytes) or over-cap file, or
 * `undefined` when the size is fine. Shared by the library pick and the
 * gallery grid (T-1320), so both refuse the same files with the same sentence.
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
  /** Real byte size read from the file when the picker reported none. */
  measuredSize?: number | undefined;
}): PickResult {
  // An unknown picker size is not an empty file: only a real zero refuses.
  // The picker reads the size from the file first (see `createAttachmentPicker`
  // below); `measuredSize` is that stat when the picker reported nothing.
  const size = input.size ?? input.measuredSize;
  const sizeError = sizeErrorMessage(size);
  if (sizeError !== undefined) {
    return { status: 'error', message: sizeError };
  }
  const mime = mimeForAsset(input.mimeType);
  const fallbackName = `photo.${extensionForMime(mime)}`;
  // Unknown stays unknown: only a real zero says "That file is empty".
  // Never coerce to 0 here — the send layer must see unknown as unknown.
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

/** One picker asset, before the size read: the shape both pickers share. */
interface AssetInput {
  uri: string;
  name: string | null | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/** The asset the image picker hands back, as the size reader and files want it. */
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

/** The real picker: library (photo or video), camera, and generic files. */
export function createAttachmentPicker(sizeReader?: SizeReader): AttachmentPicker {
  // Production defaults to the real `expo-file-system` stat (like the opener
  // defaults to `File.downloadFileAsync`); tests inject a fake reader.
  const reader = sizeReader ?? createSizeReader();
  const downscaler = createImageDownscaler({ sizeReader: reader });
  // An unknown picker size is read from the file before the cap check: only
  // a real zero says "That file is empty".
  const withRealSize = (input: AssetInput): Effect.Effect<PickResult> =>
    input.size !== undefined
      ? Effect.succeed(pickedFile(input))
      : Effect.promise(() => reader.sizeOf(input.uri)).pipe(
          Effect.map((measuredSize) => pickedFile({ ...input, measuredSize })),
        );

  // A pick resolves every asset (size, then downscale): a file that fails the
  // size rules fails the whole pick, and the rest go up together with the
  // downscaled bytes and dimensions.
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
    // Every selected document goes through the same size read and rules as a
    // library pick (T-1536), so several files stage together.
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

/** One page of gallery assets as the inline grid shows them (T-1320). */
export interface GalleryPage {
  assets: GalleryAsset[];
  endCursor: string;
  hasNextPage: boolean;
}

/** One recent asset of the phone's media library, before it is picked. */
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
 * Reads the phone's recent photos and videos for the attach sheet's Gallery tab
 * (T-1320). `toPickedFile` turns one selected asset into the same `PickedFile`
 * the library picker stages: it resolves a local `file://` URI (the `ph://`
 * display URI is not uploadable), reads the byte size, refuses an empty or
 * over-cap file with the same fixed sentence, and runs the photo downscale,
 * exactly like `pickImageOrVideo` does for `expo-image-picker`.
 */
export type GalleryPickResult =
  { status: 'picked'; file: PickedFile } | { status: 'error'; message: string };

export interface GalleryReader {
  requestPermission(): Promise<boolean>;
  loadPage(input: { after?: string | undefined; pageSize: number }): Promise<GalleryPage>;
  toPickedFile(asset: GalleryAsset): Promise<GalleryPickResult>;
}

/** One media-library asset as the gallery grid and the picker want it. */
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
 * The real gallery reader: `expo-media-library` for the pages and the local
 * URI, the shared size reader and photo downscaler for the staged bytes.
 * `MediaLibrary.getAssetInfoAsync` may fail for an iCloud asset; the display
 * URI is then kept, so the grid still works and only the upload is left to
 * fail like any other.
 */
export function createGalleryReader(options?: {
  sizeReader?: SizeReader | undefined;
  downscaler?: ImageDownscaler | undefined;
}): GalleryReader {
  const sizeReader = options?.sizeReader ?? createSizeReader();
  const downscaler = options?.downscaler ?? createImageDownscaler({ sizeReader });
  return {
    requestPermission: () =>
      // Granular read permissions: photos and videos only, so Android 13+ never
      // asks for audio (Telegram asks for photos and videos too). The signature
      // is `requestPermissionsAsync(writeOnly?, granularPermissions?)`
      // (`expo-media-library` 57, `GranularPermission = 'audio' | 'photo' | 'video'`).
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

/** Resolves the real byte size of a local file, or undefined when unknown. */
export interface SizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

/** The real size reader: `expo-file-system` stat of the picked file. */
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
