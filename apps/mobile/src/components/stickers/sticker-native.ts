import {
  fitStickerSize,
  sniffMotionBytes,
  STICKER_PREP_MAX_DIM,
  STICKER_SNIFF_BYTES,
  type MotionKind,
} from '@zilar/chat-core';
import { Effect, type Effect as EffectType } from 'effect';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as LegacyFileSystem from 'expo-file-system/legacy';

/**
 * The seams the sticker pack editor needs, in one place so tests inject fakes
 * and never touch the native modules (the `avatar-native.ts` pattern).
 */

export { fitStickerSize, STICKER_PREP_MAX_DIM };
export const STICKER_PREP_MAX_BYTES = 512 * 1024;
/** The raw cap for a moving file the server converts (a GIF or a video, T-1496). */
export const STICKER_MOVE_MAX_BYTES = 4 * 1024 * 1024;
/** WebP qualities tried from first to last; the first result under the cap wins. */
export const STICKER_PREP_QUALITY_STEPS = [0.92, 0.8, 0.7, 0.6, 0.5] as const;

export interface PickedStickerImage {
  uri: string;
  width: number;
  height: number;
  kind: 'image' | 'video';
  mimeType?: string;
  fileSize?: number;
  fileName?: string;
}

export type PickStickerResult =
  | { status: 'picked'; images: PickedStickerImage[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface StickerImagePicker {
  pickImages(): Promise<PickStickerResult>;
}

export interface PreparedStickerImage {
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
}

export type PrepareStickerResult =
  { status: 'prepared'; image: PreparedStickerImage } | { status: 'error'; message: string };

export interface StickerImagePreparer {
  prepare(image: PickedStickerImage): Promise<PrepareStickerResult>;
}

export interface StickerSizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

export interface StickerByteReader {
  readHead(uri: string, length: number): Promise<Uint8Array | undefined>;
}

const DENIED_MESSAGE =
  'Zilar needs access to your photos to add stickers. You can allow it in Settings.';
const PICK_FAILED_MESSAGE = 'Could not pick those images. Try again.';

const sizeOfEffect = (
  getInfo: typeof LegacyFileSystem.getInfoAsync,
  uri: string,
): EffectType.Effect<number | undefined> =>
  Effect.tryPromise({ try: () => getInfo(uri), catch: () => undefined }).pipe(
    Effect.map((info) =>
      info.exists === true && info.isDirectory === false ? info.size : undefined,
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  );

export function createStickerSizeReader(
  getInfo: typeof LegacyFileSystem.getInfoAsync = LegacyFileSystem.getInfoAsync,
): StickerSizeReader {
  return {
    sizeOf(uri) {
      return Effect.runPromise(sizeOfEffect(getInfo, uri));
    },
  };
}

function base64Bytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const readHeadEffect = (
  readString: typeof LegacyFileSystem.readAsStringAsync,
  uri: string,
  length: number,
): EffectType.Effect<Uint8Array | undefined> =>
  Effect.tryPromise({
    try: () => readString(uri, { encoding: 'base64', position: 0, length }),
    catch: () => undefined,
  }).pipe(
    Effect.map(base64Bytes),
    Effect.catch(() => Effect.succeed(undefined)),
  );

export function createStickerByteReader(
  readString: typeof LegacyFileSystem.readAsStringAsync = LegacyFileSystem.readAsStringAsync,
): StickerByteReader {
  return {
    readHead(uri, length) {
      return Effect.runPromise(readHeadEffect(readString, uri, length));
    },
  };
}

const manipulateOrUndefined = <A>(run: () => PromiseLike<A>): EffectType.Effect<A | undefined> =>
  Effect.tryPromise(run).pipe(Effect.catch(() => Effect.succeed(undefined)));

const sizeOfPrepared = (
  reader: StickerSizeReader,
  uri: string,
): EffectType.Effect<number | undefined> => Effect.promise(() => reader.sizeOf(uri));

/**
 * The motion kind of a picked file: a picked video is moving whatever its bytes
 * say, otherwise the first bytes are sniffed; an unreadable file stays still.
 */
const motionKindEffect = (
  byteReader: StickerByteReader,
  image: PickedStickerImage,
): EffectType.Effect<MotionKind | null> =>
  Effect.gen(function* () {
    if (image.kind === 'video') {
      return 'video' as const;
    }
    const bytes = yield* Effect.promise(() => byteReader.readHead(image.uri, STICKER_SNIFF_BYTES));
    return bytes === undefined ? null : sniffMotionBytes(bytes);
  });

/**
 * A GIF, video, animated WebP or APNG goes to the server raw: the file is kept
 * as it is and the server sniffs the bytes. A GIF or video is capped at 4 MiB;
 * a moving WebP or PNG is already a sticker and is capped at 512 KiB.
 */
const keepMovingEffect = (
  reader: StickerSizeReader,
  image: PickedStickerImage,
  kind: MotionKind,
): EffectType.Effect<PrepareStickerResult> =>
  Effect.gen(function* () {
    let bytes = image.fileSize;
    if (bytes === undefined || bytes === 0) {
      bytes = yield* sizeOfPrepared(reader, image.uri);
    }
    const name =
      image.fileName !== undefined && image.fileName !== '' ? image.fileName : 'This clip';
    if (kind === 'animated-webp' || kind === 'apng') {
      if (bytes !== undefined && bytes > STICKER_PREP_MAX_BYTES) {
        return {
          status: 'error',
          message: `${name}: a moving WebP or PNG must be under 512 KiB.`,
        };
      }
    } else if (bytes !== undefined && bytes > STICKER_MOVE_MAX_BYTES) {
      return { status: 'error', message: `${name}: over 4 MiB. Try a shorter clip.` };
    }
    return {
      status: 'prepared',
      image: {
        uri: image.uri,
        mimeType: image.mimeType ?? 'application/octet-stream',
        width: 0,
        height: 0,
        bytes: bytes ?? 0,
      },
    };
  });

const prepareEffect = Effect.fnUntraced(function* (
  manipulate: typeof manipulateAsync,
  reader: StickerSizeReader,
  byteReader: StickerByteReader,
  image: PickedStickerImage,
): EffectType.fn.Return<PrepareStickerResult> {
  const moving = yield* motionKindEffect(byteReader, image);
  if (moving !== null) {
    return yield* keepMovingEffect(reader, image, moving);
  }
  const size = fitStickerSize(image.width, image.height);
  for (const quality of STICKER_PREP_QUALITY_STEPS) {
    const saved = yield* manipulateOrUndefined(() =>
      manipulate(image.uri, [{ resize: { width: size.width, height: size.height } }], {
        format: SaveFormat.WEBP,
        compress: quality,
      }),
    );
    if (saved === undefined) {
      continue;
    }
    const bytes = yield* sizeOfPrepared(reader, saved.uri);
    if (bytes === undefined) {
      // The size is unknown: accept the first WebP save (only a real zero refuses).
      return {
        status: 'prepared',
        image: {
          uri: saved.uri,
          mimeType: 'image/webp',
          width: size.width,
          height: size.height,
          bytes: STICKER_PREP_MAX_BYTES,
        },
      };
    }
    if (bytes === 0) {
      return { status: 'error', message: 'This image is empty.' };
    }
    if (bytes <= STICKER_PREP_MAX_BYTES) {
      return {
        status: 'prepared',
        image: {
          uri: saved.uri,
          mimeType: 'image/webp',
          width: size.width,
          height: size.height,
          bytes,
        },
      };
    }
  }
  const savedPng = yield* manipulateOrUndefined(() =>
    manipulate(image.uri, [{ resize: { width: size.width, height: size.height } }], {
      format: SaveFormat.PNG,
    }),
  );
  if (savedPng === undefined) {
    return { status: 'error', message: 'This image could not be prepared.' };
  }
  const uri = savedPng.uri;
  const bytes = yield* sizeOfPrepared(reader, uri);
  if (bytes !== undefined && bytes === 0) {
    return { status: 'error', message: 'This image is empty.' };
  }
  if (bytes !== undefined && bytes > STICKER_PREP_MAX_BYTES) {
    return {
      status: 'error',
      message: 'This image is too big. A sticker can be up to 512 KB and 512 px.',
    };
  }
  return {
    status: 'prepared',
    image: {
      uri,
      mimeType: 'image/png',
      width: size.width,
      height: size.height,
      bytes: bytes ?? STICKER_PREP_MAX_BYTES,
    },
  };
});

/**
 * The real preparer: sniff the picked bytes first, keep a moving file raw (the
 * server converts a GIF or video), otherwise fit a still inside 512 x 512, encode
 * WebP at each quality step until it fits 512 KiB, then one PNG try.
 */
export function createStickerPreparer(
  manipulate: typeof manipulateAsync = manipulateAsync,
  sizeReader?: StickerSizeReader,
  byteReader?: StickerByteReader,
): StickerImagePreparer {
  const reader = sizeReader ?? createStickerSizeReader();
  const head = byteReader ?? createStickerByteReader();
  return {
    prepare(image) {
      return Effect.runPromise(prepareEffect(manipulate, reader, head, image));
    },
  };
}

const launchEffect = (): EffectType.Effect<PickStickerResult> =>
  Effect.tryPromise(() =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      videoMaxDuration: 3,
    }),
  ).pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.succeed<PickStickerResult>({ status: 'error', message: PICK_FAILED_MESSAGE }),
      onSuccess: (result) => Effect.succeed(pickResultOf(result)),
    }),
  );

function pickResultOf(result: ImagePicker.ImagePickerResult): PickStickerResult {
  if (result.canceled) {
    return { status: 'cancelled' };
  }
  return {
    status: 'picked',
    images: result.assets.map((asset) => ({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      kind: asset.type === 'video' ? 'video' : 'image',
      ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
      ...(asset.fileSize === undefined ? {} : { fileSize: asset.fileSize }),
      ...(asset.fileName === undefined || asset.fileName === null || asset.fileName === ''
        ? {}
        : { fileName: asset.fileName }),
    })),
  };
}

const pickEffect = (): EffectType.Effect<PickStickerResult> =>
  Effect.promise(() => ImagePicker.requestMediaLibraryPermissionsAsync()).pipe(
    Effect.flatMap((permission) =>
      permission.granted
        ? launchEffect()
        : Effect.succeed<PickStickerResult>({ status: 'error', message: DENIED_MESSAGE }),
    ),
  );

export function createStickerImagePicker(): StickerImagePicker {
  return {
    pickImages() {
      return Effect.runPromise(pickEffect());
    },
  };
}
