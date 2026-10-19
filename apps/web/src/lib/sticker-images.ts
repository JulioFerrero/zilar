/** Fits stills inside 512 x 512 and encodes WebP (PNG fallback) within 512 KiB; the server
 * validates again. Moving files (GIF, video, animated WebP, APNG) skip the canvas so they
 * keep their motion and the server converts them; decode/encode are injectable for tests. */
import {
  fitStickerSize,
  STICKER_PREP_MAX_DIM,
  STICKER_SNIFF_BYTES,
  sniffMotionBytes,
  type MotionKind,
} from '@zilar/chat-core';
import { Data, Effect } from 'effect';

// effect-plain: the Blob slice and the async boundary web's prepare flow needs; the byte
// rules live in @zilar/chat-core.

async function sniffMotion(file: Blob): Promise<MotionKind | null> {
  const bytes = new Uint8Array(await file.slice(0, STICKER_SNIFF_BYTES).arrayBuffer());
  return sniffMotionBytes(bytes);
}

export const STICKER_PREP_MAX_BYTES = 512 * 1024;
/** The server's raw-upload cap for a moving file it converts. */
export const STICKER_PREP_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** WebP qualities tried from first to last; the first result under the cap wins. */
export const STICKER_PREP_QUALITY_STEPS = [0.92, 0.8, 0.7, 0.6, 0.5] as const;
export const STICKER_PREP_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/webm',
  'video/mp4',
  'video/quicktime',
] as const;

export type StickerPrepMime = 'image/webp' | 'image/png';
/** 'video' needs a <video> preview; 'animated' is a GIF, WebP or APNG. */
export type StickerPrepMotion = 'none' | 'animated' | 'video';
export type PrepFailureReason =
  'unsupported_type' | 'decode_failed' | 'encode_failed' | 'too_large';

export class PrepError extends Error {
  readonly reason: PrepFailureReason;
  readonly fileName: string;

  constructor(reason: PrepFailureReason, fileName: string, message: string) {
    super(message);
    this.name = 'PrepError';
    this.reason = reason;
    this.fileName = fileName;
  }
}

class EncodeAttemptFailed extends Data.TaggedError('EncodeAttemptFailed') {}

/** Reading the leading bytes failed; treated as no motion detected. */
class SniffFailed extends Data.TaggedError('SniffFailed') {}

export interface PrepBitmap {
  width: number;
  height: number;
  image: unknown;
}

export interface PrepDeps {
  decode: (file: Blob) => Promise<PrepBitmap>;
  encode: (
    image: unknown,
    width: number,
    height: number,
    mime: StickerPrepMime,
    quality: number,
  ) => Promise<Blob | null>;
  /** Releases the decoded image after the final encode (closes the bitmap). */
  release?: ((image: unknown) => void) | undefined;
}

export interface PrepResult {
  blob: Blob;
  mime: StickerPrepMime;
  width: number;
  height: number;
  bytes: number;
  motion: StickerPrepMotion;
}

function isAcceptedType(type: string): boolean {
  return (STICKER_PREP_ACCEPTED_TYPES as readonly string[]).includes(type);
}

function isReadableBitmap(decoded: PrepBitmap): boolean {
  return (
    Number.isFinite(decoded.width) &&
    Number.isFinite(decoded.height) &&
    decoded.width > 0 &&
    decoded.height > 0
  );
}

/** Decodes a still with createImageBitmap; moving files skip this. */
function decodeWithBitmap(file: Blob): Promise<PrepBitmap> {
  // Never closed here: a closed bitmap is detached and drawImage throws, so it stays
  // open until releaseBitmap runs after the final encode.
  return Effect.runPromise(
    Effect.promise(() => createImageBitmap(file)).pipe(
      Effect.map((bitmap) => ({ width: bitmap.width, height: bitmap.height, image: bitmap })),
    ),
  );
}

/** Closes the decoded bitmap after the final encode; GC reclaims the rest. */
function releaseBitmap(image: unknown): void {
  if (typeof image === 'object' && image !== null && 'close' in image) {
    const close = (image as { close?: unknown }).close;
    if (typeof close === 'function') {
      close.call(image);
    }
  }
}

/** Encodes through a <canvas>; null when the browser cannot do the mime. */
function encodeWithCanvas(
  image: unknown,
  width: number,
  height: number,
  mime: StickerPrepMime,
  quality: number,
): Promise<Blob | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) {
        return null;
      }
      yield* Effect.sync(() => {
        context.drawImage(image as CanvasImageSource, 0, 0, width, height);
      });
      return yield* Effect.callback<Blob | null>((resume) => {
        canvas.toBlob(
          (blob) => resume(Effect.succeed(blob)),
          mime,
          mime === 'image/webp' ? quality : undefined,
        );
      });
    }),
  );
}

function defaultDeps(): PrepDeps {
  return { decode: decodeWithBitmap, encode: encodeWithCanvas, release: releaseBitmap };
}

/** Throws a PrepError with a human-readable message; the caller keeps the other files. */
export function prepareStickerImage(
  file: File,
  deps: PrepDeps = defaultDeps(),
): Promise<PrepResult> {
  return Effect.runPromise(prepareEffect(file, deps));
}

function prepareEffect(file: File, deps: PrepDeps): Effect.Effect<PrepResult, PrepError> {
  const name = file.name !== '' ? file.name : 'image';
  return Effect.gen(function* () {
    const kind = yield* Effect.tryPromise({
      try: () => sniffMotion(file),
      catch: () => new SniffFailed(),
    }).pipe(Effect.orElseSucceed((): MotionKind | null => null));
    // A .mov may arrive with an empty type, so a sniffed kind also accepts it.
    if (!isAcceptedType(file.type) && kind === null) {
      return yield* Effect.fail(
        new PrepError(
          'unsupported_type',
          name,
          `${name}: only PNG, JPEG, WebP, GIF images and short videos work as stickers.`,
        ),
      );
    }
    if (kind === 'gif' || kind === 'video') {
      return yield* keepMovingFile(name, file, kind === 'video' ? 'video' : 'animated');
    }
    if (kind === 'animated-webp' || kind === 'apng') {
      return yield* keepAnimatedFile(name, file, kind, deps);
    }
    return yield* prepareStill(name, file, deps);
  });
}

/** A GIF or video goes to the server raw; the server converts it. */
function keepMovingFile(
  name: string,
  file: File,
  motion: 'animated' | 'video',
): Effect.Effect<PrepResult, PrepError> {
  if (file.size > STICKER_PREP_UPLOAD_MAX_BYTES) {
    return Effect.fail(
      new PrepError('too_large', name, `${name}: over 4 MiB. Try a shorter clip.`),
    );
  }
  const result: PrepResult = {
    blob: file,
    mime: 'image/webp',
    width: 0,
    height: 0,
    bytes: file.size,
    motion,
  };
  return Effect.succeed(result);
}

/** An animated WebP or APNG is already a sticker; only its size is checked. */
function keepAnimatedFile(
  name: string,
  file: File,
  kind: 'animated-webp' | 'apng',
  deps: PrepDeps,
): Effect.Effect<PrepResult, PrepError> {
  if (file.size > STICKER_PREP_MAX_BYTES) {
    return Effect.fail(
      new PrepError('too_large', name, `${name}: a moving WebP or PNG must be under 512 KiB.`),
    );
  }
  return Effect.gen(function* () {
    // Decoded only to read its size, then released; the file itself is kept.
    const decoded = yield* Effect.tryPromise({
      try: () => deps.decode(file),
      catch: () => new PrepError('decode_failed', name, `${name}: the image could not be read.`),
    });
    return yield* measureAnimated(name, file, kind, decoded).pipe(
      Effect.ensuring(
        Effect.try(() => deps.release?.(decoded.image)).pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );
  });
}

function measureAnimated(
  name: string,
  file: File,
  kind: 'animated-webp' | 'apng',
  decoded: PrepBitmap,
): Effect.Effect<PrepResult, PrepError> {
  if (!isReadableBitmap(decoded)) {
    return Effect.fail(
      new PrepError('decode_failed', name, `${name}: the image could not be read.`),
    );
  }
  if (decoded.width > STICKER_PREP_MAX_DIM || decoded.height > STICKER_PREP_MAX_DIM) {
    return Effect.fail(
      new PrepError('too_large', name, `${name}: a moving WebP or PNG must be at most 512 × 512.`),
    );
  }
  const result: PrepResult = {
    blob: file,
    mime: kind === 'apng' ? 'image/png' : 'image/webp',
    width: decoded.width,
    height: decoded.height,
    bytes: file.size,
    motion: 'animated',
  };
  return Effect.succeed(result);
}

function prepareStill(
  name: string,
  file: File,
  deps: PrepDeps,
): Effect.Effect<PrepResult, PrepError> {
  return Effect.gen(function* () {
    const decoded = yield* Effect.tryPromise({
      try: () => deps.decode(file),
      catch: () => new PrepError('decode_failed', name, `${name}: the image could not be read.`),
    });
    if (!isReadableBitmap(decoded)) {
      return yield* Effect.fail(
        new PrepError('decode_failed', name, `${name}: the image could not be read.`),
      );
    }
    const size = fitStickerSize(decoded.width, decoded.height);
    const attempt = (mime: StickerPrepMime, quality: number): Effect.Effect<Blob | null> =>
      Effect.tryPromise({
        try: () => deps.encode(decoded.image, size.width, size.height, mime, quality),
        catch: () => new EncodeAttemptFailed(),
      }).pipe(Effect.orElseSucceed(() => null));

    return yield* encodeStages(name, size, attempt).pipe(
      // The image is released after the final encode, never before: closing an ImageBitmap
      // detaches it and drawImage throws on it. Releasing is best effort.
      Effect.ensuring(
        Effect.try(() => deps.release?.(decoded.image)).pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );
  });
}

/** WebP first (quality steps down while over the cap), then one PNG try; a failed encode is null. */
function encodeStages(
  name: string,
  size: { width: number; height: number },
  attempt: (mime: StickerPrepMime, quality: number) => Effect.Effect<Blob | null>,
): Effect.Effect<PrepResult, PrepError> {
  return Effect.gen(function* () {
    let blob = yield* attempt('image/webp', STICKER_PREP_QUALITY_STEPS[0]!);
    if (blob !== null && blob.size > STICKER_PREP_MAX_BYTES) {
      for (const quality of STICKER_PREP_QUALITY_STEPS.slice(1)) {
        const stepped = yield* attempt('image/webp', quality);
        blob = stepped ?? blob;
        if (blob.size <= STICKER_PREP_MAX_BYTES) {
          break;
        }
      }
    }
    if (blob !== null && blob.size <= STICKER_PREP_MAX_BYTES) {
      return {
        blob,
        mime: 'image/webp',
        width: size.width,
        height: size.height,
        bytes: blob.size,
        motion: 'none',
      };
    }
    // The browser cannot encode WebP, or no quality fits: one PNG attempt.
    blob = yield* attempt('image/png', 1);
    if (blob === null || blob.size <= 0) {
      return yield* Effect.fail(
        new PrepError(
          'encode_failed',
          name,
          `${name}: the image could not be converted. Try another file.`,
        ),
      );
    }
    if (blob.size > STICKER_PREP_MAX_BYTES) {
      return yield* Effect.fail(
        new PrepError(
          'too_large',
          name,
          `${name}: still over 512 KiB after conversion. Try a smaller image.`,
        ),
      );
    }
    return {
      blob,
      mime: 'image/png',
      width: size.width,
      height: size.height,
      bytes: blob.size,
      motion: 'none',
    };
  });
}
