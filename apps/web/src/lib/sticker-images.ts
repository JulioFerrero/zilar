/**
 * Client-side sticker preparation (T-0121): decodes a picked image, fits it
 * inside 512 x 512 keeping the ratio, and encodes it as WebP (PNG fallback)
 * within 512 KiB. The server validates everything again (T-0120); this only
 * gets files ready so the upload rarely fails.
 *
 * The module is pure: `decode`/`encode` are injectable so tests use fakes
 * and never touch a canvas. Production passes the browser defaults that use
 * `createImageBitmap` (a GIF decodes to its first frame: a still) and a
 * `<canvas>` encode.
 */
import { Data, Effect } from 'effect';

export const STICKER_PREP_MAX_DIM = 512;
export const STICKER_PREP_MAX_BYTES = 512 * 1024;
/** WebP qualities tried from first to last; the first result under the cap wins. */
export const STICKER_PREP_QUALITY_STEPS = [0.92, 0.8, 0.7, 0.6, 0.5] as const;
export const STICKER_PREP_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type StickerPrepMime = 'image/webp' | 'image/png';
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

/** One encode call failed; the next step decides what to do. */
class EncodeAttemptFailed extends Data.TaggedError('EncodeAttemptFailed') {}

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
}

/** Fits a size inside 512 x 512 keeping the ratio; small images stay as-is. */
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

function isAcceptedType(type: string): boolean {
  return (STICKER_PREP_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** Decodes with `createImageBitmap`: a GIF yields its first frame (a still). */
function decodeWithBitmap(file: Blob): Promise<PrepBitmap> {
  // Never closed here: a closed bitmap is detached and `drawImage` throws,
  // so it stays open until `releaseBitmap` runs after the final encode.
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

/** Encodes through a `<canvas>`; `null` when the browser cannot do the mime. */
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

/**
 * Prepares one picked file for upload. Throws a `PrepError` with a
 * human-readable message; the caller keeps the other files.
 */
export function prepareStickerImage(
  file: File,
  deps: PrepDeps = defaultDeps(),
): Promise<PrepResult> {
  return Effect.runPromise(prepareEffect(file, deps));
}

function prepareEffect(file: File, deps: PrepDeps): Effect.Effect<PrepResult, PrepError> {
  const name = file.name !== '' ? file.name : 'image';
  return Effect.gen(function* () {
    if (!isAcceptedType(file.type)) {
      return yield* Effect.fail(
        new PrepError(
          'unsupported_type',
          name,
          `${name}: only PNG, JPEG, WebP or GIF images work as stickers.`,
        ),
      );
    }
    const decoded = yield* Effect.tryPromise({
      try: () => deps.decode(file),
      catch: () => new PrepError('decode_failed', name, `${name}: the image could not be read.`),
    });
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
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
      // The decoded image is released after the final encode, never before:
      // closing an ImageBitmap detaches it and `drawImage` throws on it.
      // Releasing is best-effort; GC reclaims the bitmap either way.
      Effect.ensuring(
        Effect.try(() => deps.release?.(decoded.image)).pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );
  });
}

/**
 * WebP first (quality steps down while over the cap), then one PNG try.
 * `attempt` never fails: a failed encode is `null`.
 */
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
    return { blob, mime: 'image/png', width: size.width, height: size.height, bytes: blob.size };
  });
}

/** "320 x 410 · 84 KiB" for the editor preview. */
export function formatStickerSize(width: number, height: number, bytes: number): string {
  const kib = bytes / 1024;
  const rounded = Math.round(kib * 10) / 10;
  const size = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${width}×${height} · ${size} KiB`;
}
