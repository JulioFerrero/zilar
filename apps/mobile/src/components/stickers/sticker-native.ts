import { Effect, type Effect as EffectType } from 'effect';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as LegacyFileSystem from 'expo-file-system/legacy';

/**
 * The seams the sticker pack editor needs, kept in one place so tests
 * inject fakes and never touch the native modules (the
 * `avatar-native.ts` pattern).
 */

export const STICKER_PREP_MAX_DIM = 512;
export const STICKER_PREP_MAX_BYTES = 512 * 1024;
/** WebP qualities tried from first to last; the first result under the cap wins. */
export const STICKER_PREP_QUALITY_STEPS = [0.92, 0.8, 0.7, 0.6, 0.5] as const;

export interface PickedStickerImage {
  uri: string;
  width: number;
  height: number;
}

export type PickStickerResult =
  | { status: 'picked'; images: PickedStickerImage[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface StickerImagePicker {
  pickImages(): Promise<PickStickerResult>;
}

/** One prepared sticker file, ready for the binary upload. */
export interface PreparedStickerImage {
  uri: string;
  mimeType: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
}

export type PrepareStickerResult =
  { status: 'prepared'; image: PreparedStickerImage } | { status: 'error'; message: string };

export interface StickerImagePreparer {
  prepare(image: PickedStickerImage): Promise<PrepareStickerResult>;
}

/** Reads the byte size of a local file, or undefined when unknown. */
export interface StickerSizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

const DENIED_MESSAGE =
  'Zilar needs access to your photos to add stickers. You can allow it in Settings.';
const PICK_FAILED_MESSAGE = 'Could not pick those images. Try again.';

/**
 * Fits a size inside 512 x 512 keeping the ratio; small images stay as-is
 * (web's `fitStickerSize` in `apps/web/src/lib/sticker-images.ts`).
 */
export function fitStickerSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= STICKER_PREP_MAX_DIM) {
    return { width, height };
  }
  const scale = STICKER_PREP_MAX_DIM / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The byte size of a local file as an Effect: a failed stat is `undefined`,
 * the same as the old try/catch.
 */
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

/** The real size reader: `expo-file-system` stat of the prepared file. */
export function createStickerSizeReader(
  getInfo: typeof LegacyFileSystem.getInfoAsync = LegacyFileSystem.getInfoAsync,
): StickerSizeReader {
  return {
    sizeOf(uri) {
      return Effect.runPromise(sizeOfEffect(getInfo, uri));
    },
  };
}

/**
 * A manipulator call as an Effect: a throw is `undefined`, so the caller
 * skips that step, the way the old try/catch did.
 */
const manipulateOrUndefined = <A>(run: () => PromiseLike<A>): EffectType.Effect<A | undefined> =>
  Effect.tryPromise(run).pipe(Effect.catch(() => Effect.succeed(undefined)));

/** The size reader is a Promise seam, so its rejection stays a defect. */
const sizeOfPrepared = (
  reader: StickerSizeReader,
  uri: string,
): EffectType.Effect<number | undefined> => Effect.promise(() => reader.sizeOf(uri));

const prepareEffect = Effect.fnUntraced(function* (
  manipulate: typeof manipulateAsync,
  reader: StickerSizeReader,
  image: PickedStickerImage,
): EffectType.fn.Return<PrepareStickerResult> {
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
      // The size is unknown: accept the first WebP save, like the
      // avatar flow accepts an unknown size (only a real zero refuses).
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
  // No WebP fit (every step too big, or the saves threw): one PNG try.
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
 * The real preparer: fit inside 512 x 512 keeping the ratio, encode WebP
 * at each quality step until the result fits in 512 KiB, then one PNG try
 * (web's `prepareStickerImage`, without the decode: the manipulator reads
 * the JPEG/GIF asset itself). When a WebP save throws, the steps that
 * throw are skipped and the PNG try runs.
 */
export function createStickerPreparer(
  manipulate: typeof manipulateAsync = manipulateAsync,
  sizeReader?: StickerSizeReader,
): StickerImagePreparer {
  const reader = sizeReader ?? createStickerSizeReader();
  return {
    prepare(image) {
      return Effect.runPromise(prepareEffect(manipulate, reader, image));
    },
  };
}

const launchEffect = (): EffectType.Effect<PickStickerResult> =>
  Effect.tryPromise(() =>
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
    }),
  ).pipe(
    Effect.matchEffect({
      onFailure: () =>
        Effect.succeed<PickStickerResult>({ status: 'error', message: PICK_FAILED_MESSAGE }),
      onSuccess: (result) => Effect.succeed(pickResultOf(result)),
    }),
  );

/** Maps the picker's answer to the screen's result; a cancel is not an error. */
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

/** The real picker: the photo library, multi-select, images only, no editing. */
export function createStickerImagePicker(): StickerImagePicker {
  return {
    pickImages() {
      return Effect.runPromise(pickEffect());
    },
  };
}
