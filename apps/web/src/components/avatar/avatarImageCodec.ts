/**
 * Avatar image codec for `AvatarUploader`: the phases of the picker, the
 * browser decode/encode Effects (with Promise-typed injectable edges) and the
 * preview-URL helpers. Moved unchanged from `AvatarUploader.tsx` (size split).
 */
import { Data, Effect } from 'effect';
import { AVATAR_EXPORT_SIDE, exportDrawArgs, type CropState } from '@/lib/avatar-crop';

export type Phase =
  | { name: 'idle' }
  | {
      name: 'crop';
      fileName: string;
      objectUrl: string;
      natural: { width: number; height: number };
    }
  | { name: 'error'; message: string };

export type ImageSize = { width: number; height: number };
export type ImageLoader = (objectUrl: string) => Promise<ImageSize>;
export type Exporter = (
  image: HTMLImageElement,
  source: ImageSize,
  state: CropState,
  mime: 'image/webp' | 'image/png',
) => Promise<Blob | null>;

/** The browser could not decode the picked file. */
export class ImageUnreadable extends Data.TaggedError('ImageUnreadable') {}

/** Decodes the picked file. Interrupting the load clears the image handlers. */
const loadImageSize = (objectUrl: string): Effect.Effect<ImageSize, ImageUnreadable> =>
  Effect.callback<ImageSize, ImageUnreadable>((resume) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = (): void =>
      resume(Effect.succeed({ width: image.naturalWidth, height: image.naturalHeight }));
    image.onerror = (): void => resume(Effect.fail(new ImageUnreadable()));
    image.src = objectUrl;
    return Effect.sync(() => {
      image.onload = null;
      image.onerror = null;
    });
  });

/** Draws the crop onto a canvas and encodes it. A null blob means no encoder. */
const encodeAvatar = (
  image: HTMLImageElement,
  source: ImageSize,
  state: CropState,
  mime: 'image/webp' | 'image/png',
): Effect.Effect<Blob | null> =>
  Effect.callback<Blob | null>((resume) => {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EXPORT_SIDE;
    canvas.height = AVATAR_EXPORT_SIDE;
    const context = canvas.getContext('2d');
    if (context === null) {
      resume(Effect.succeed(null));
      return;
    }
    const args = exportDrawArgs(source, state);
    context.drawImage(
      image,
      args.sx,
      args.sy,
      args.sSide,
      args.sSide,
      0,
      0,
      args.dSide,
      args.dSide,
    );
    canvas.toBlob(
      (blob) => resume(Effect.succeed(blob)),
      mime,
      mime === 'image/webp' ? 0.92 : undefined,
    );
  });

// The injectable props keep their Promise types (the tests pass Promise
// fakes), so the browser defaults run their Effects at this edge.
export const defaultImageLoader: ImageLoader = (objectUrl) =>
  Effect.runPromise(loadImageSize(objectUrl));
export const defaultExporter: Exporter = (image, source, state, mime) =>
  Effect.runPromise(encodeAvatar(image, source, state, mime));

// jsdom (and some test environments) has no `URL.createObjectURL`: fall
// back to a synthetic url the injected `imageLoader` fake ignores. The
// `<img>` still gets a `src`, so production behaviour is unchanged.
let previewCounter = 0;

const syntheticPreviewUrl = (): string => {
  previewCounter += 1;
  return `avatar-preview-${previewCounter}`;
};

/** The preview URL for a picked file; a browser that refuses it gets the synthetic url. */
export const previewUrlFor = (file: File): Effect.Effect<string> =>
  typeof URL.createObjectURL === 'function'
    ? Effect.try(() => URL.createObjectURL(file)).pipe(Effect.orElseSucceed(syntheticPreviewUrl))
    : Effect.sync(syntheticPreviewUrl);

/** Best effort: a refused revoke is ignored. */
export const revokePreviewUrl = (url: string): Effect.Effect<void> =>
  url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function'
    ? Effect.ignore(Effect.try(() => URL.revokeObjectURL(url)))
    : Effect.void;

export interface PickedCrop {
  image: HTMLImageElement;
  natural: ImageSize;
  objectUrl: string;
  crop: CropState;
}

/** WebP first, then PNG when the browser cannot encode WebP. A null result means neither. */
export const exportAvatarFile = (
  exporter: Exporter,
  picked: PickedCrop,
): Effect.Effect<File | null, unknown> =>
  Effect.gen(function* () {
    const webp = yield* Effect.tryPromise({
      try: () => exporter(picked.image, picked.natural, picked.crop, 'image/webp'),
      catch: (cause) => cause,
    });
    if (webp !== null) {
      return new File([webp], 'avatar', { type: 'image/webp' });
    }
    const png = yield* Effect.tryPromise({
      try: () => exporter(picked.image, picked.natural, picked.crop, 'image/png'),
      catch: (cause) => cause,
    });
    return png === null ? null : new File([png], 'avatar', { type: 'image/png' });
  });
