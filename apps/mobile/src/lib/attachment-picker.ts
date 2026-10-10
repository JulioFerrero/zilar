/**
 * The real native picker seams (T-1021, split from `attachment-native.ts`):
 * `expo-image-picker` for photos, videos and the camera, and
 * `expo-document-picker` for generic files.
 */

import { Effect, type Effect as EffectType } from 'effect';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { extensionForMime, MAX_ATTACHMENT_BYTES, mimeForAsset } from './attachments';
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
  if (size !== undefined && size === 0) {
    return { status: 'error', message: EMPTY_MESSAGE };
  }
  if (tooLarge(size)) {
    return { status: 'error', message: TOO_LARGE_MESSAGE };
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
  return { status: 'picked', file };
}

/** The real picker: library (photo or video), camera, and generic files. */
export function createAttachmentPicker(sizeReader?: SizeReader): AttachmentPicker {
  // Production defaults to the real `expo-file-system` stat (like the opener
  // defaults to `File.downloadFileAsync`); tests inject a fake reader.
  const reader = sizeReader ?? createSizeReader();
  // An unknown picker size is read from the file before the cap check: only
  // a real zero says "That file is empty".
  const withRealSize = (input: {
    uri: string;
    name: string | null | undefined;
    mimeType: string | undefined;
    size: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
  }): Effect.Effect<PickResult> =>
    input.size !== undefined
      ? Effect.succeed(pickedFile(input))
      : Effect.promise(() => reader.sizeOf(input.uri)).pipe(
          Effect.map((measuredSize) => pickedFile({ ...input, measuredSize })),
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
        }),
      catch: () => new NativeFailure({ message: PICK_FAILED_MESSAGE }),
    });
    if (result.canceled) {
      return { status: 'cancelled' };
    }
    const asset = result.assets[0];
    if (asset === undefined) {
      return { status: 'cancelled' };
    }
    const mime = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
    const name =
      asset.fileName ?? `photo.${extensionForMime(mime === undefined ? undefined : mime)}`;
    return yield* withRealSize({
      uri: asset.uri,
      name,
      mimeType: mime,
      size: asset.fileSize,
      width: asset.width,
      height: asset.height,
    });
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
    const mime = asset.mimeType ?? 'image/jpeg';
    const name = asset.fileName ?? `photo.${extensionForMime(mime)}`;
    return yield* withRealSize({
      uri: asset.uri,
      name,
      mimeType: mime,
      size: asset.fileSize,
      width: asset.width,
      height: asset.height,
    });
  });

  const pickFileEffect = Effect.fnUntraced(function* (): EffectType.fn.Return<
    PickResult,
    NativeFailure
  > {
    const result = yield* Effect.tryPromise({
      try: () => DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }),
      catch: () => new NativeFailure({ message: PICK_FAILED_MESSAGE }),
    });
    if (result.canceled) {
      return { status: 'cancelled' };
    }
    const asset = result.assets[0];
    if (asset === undefined) {
      return { status: 'cancelled' };
    }
    return yield* withRealSize({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
    });
  });

  return {
    pickImageOrVideo: () => Effect.runPromise(orErrorResult(pickImageOrVideoEffect())),
    takePhoto: () => Effect.runPromise(orErrorResult(takePhotoEffect())),
    pickFile: () => Effect.runPromise(orErrorResult(pickFileEffect())),
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
