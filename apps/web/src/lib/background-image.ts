// T-0464: prepare a picked file for `POST /backgrounds`. The browser resizes
// the image so its largest side fits 2048 px, re-encodes it to WebP and steps
// the quality down until the bytes fit 1 MiB; the server validates all of it
// again. `load` and `encode` are injectable so tests never touch `Image` or a
// canvas.
import { Effect } from 'effect';

/** The smallest side the server accepts (backgrounds run 64-2048 px). */
export const BACKGROUND_MIN_SIDE = 64;
/** The largest side the server accepts; the client scales down to fit. */
export const BACKGROUND_MAX_SIDE = 2048;
/** The server's upload cap. */
export const BACKGROUND_MAX_BYTES = 1024 * 1024;
/** WebP qualities tried in order until the result fits. */
const BACKGROUND_QUALITIES = [0.85, 0.7, 0.5];

export interface BackgroundSize {
  width: number;
  height: number;
}

export interface LoadedBackground {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Scale a size down so its largest side is at most `max`, keeping the ratio.
 * Never scales up, and never returns a fractional or zero side.
 */
export function fitWithin(
  width: number,
  height: number,
  max = BACKGROUND_MAX_SIDE,
): BackgroundSize {
  const largest = Math.max(width, height);
  if (largest <= max) {
    return { width, height };
  }
  const scale = max / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// The object URL lives only while the image decodes; it is revoked on every exit.
const loadFromFile = (file: File): Effect.Effect<LoadedBackground, Error> =>
  Effect.acquireUseRelease(
    Effect.sync(() => URL.createObjectURL(file)),
    (objectUrl) =>
      Effect.callback<LoadedBackground, Error>((resume) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = (): void =>
          resume(Effect.succeed({ image, width: image.naturalWidth, height: image.naturalHeight }));
        image.onerror = (): void => resume(Effect.fail(new Error('decode')));
        image.src = objectUrl;
      }),
    (objectUrl) =>
      Effect.sync(() => {
        URL.revokeObjectURL(objectUrl);
      }),
  );

const encodeWithCanvas = (
  image: CanvasImageSource,
  size: BackgroundSize,
  quality: number,
): Effect.Effect<Blob | null> =>
  Effect.gen(function* () {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) {
      return null;
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    return yield* Effect.callback<Blob | null>((resume) => {
      canvas.toBlob((blob) => resume(Effect.succeed(blob)), 'image/webp', quality);
    });
  });

/**
 * Load a file, reject images under 64 px on either side, resize it to fit
 * 2048 px and encode WebP at 0.85, 0.7 then 0.5 until it is at most 1 MiB.
 * Throws `'too_small'` or `'too_large'` so the caller can show a plain
 * sentence. A rejection from an injected `load` or `encode` passes through
 * unchanged.
 */
export function prepareBackgroundImage(
  file: File,
  deps: {
    load?: (file: File) => Promise<LoadedBackground>;
    encode?: (
      image: CanvasImageSource,
      size: BackgroundSize,
      quality: number,
    ) => Promise<Blob | null>;
  } = {},
): Promise<Blob> {
  const { load, encode } = deps;
  const loadStep: Effect.Effect<LoadedBackground, unknown> =
    load === undefined
      ? loadFromFile(file)
      : Effect.tryPromise({ try: () => load(file), catch: (cause) => cause });
  const encodeStep = (
    image: CanvasImageSource,
    size: BackgroundSize,
    quality: number,
  ): Effect.Effect<Blob | null, unknown> =>
    encode === undefined
      ? encodeWithCanvas(image, size, quality)
      : Effect.tryPromise({ try: () => encode(image, size, quality), catch: (cause) => cause });
  return Effect.runPromise(
    Effect.gen(function* () {
      const loaded = yield* loadStep;
      if (loaded.width < BACKGROUND_MIN_SIDE || loaded.height < BACKGROUND_MIN_SIDE) {
        return yield* Effect.fail(new Error('too_small'));
      }
      const size = fitWithin(loaded.width, loaded.height);
      for (const quality of BACKGROUND_QUALITIES) {
        const blob = yield* encodeStep(loaded.image, size, quality);
        if (blob !== null && blob.size <= BACKGROUND_MAX_BYTES) {
          return blob;
        }
      }
      return yield* Effect.fail(new Error('too_large'));
    }),
  );
}
