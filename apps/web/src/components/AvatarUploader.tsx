import { Data, Effect } from 'effect';
import { useCallback, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { removeAvatar, uploadAvatar } from '@/lib/api';
import {
  AVATAR_CROP_VIEW_SIDE,
  AVATAR_EXPORT_SIDE,
  clampOffset,
  clampZoom,
  exportDrawArgs,
  fitInView,
  type CropState,
} from '@/lib/avatar-crop';
import { isWaiting, useAction } from '@/lib/effect/use-action';

export type AvatarKind = 'user' | 'ai' | 'group';

/** Files the browser refuses to even load: not an image, or absurdly large. */
const MAX_LOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface AvatarUploaderProps {
  kind: AvatarKind;
  ownerId: string;
  ownerName: string;
  /** The current picture URL, if any. */
  currentUrl?: string | undefined;
  /** Called with the new URL after a save, or undefined after a remove. */
  onChanged: (url: string | undefined) => void;
}

type Phase =
  | { name: 'idle' }
  | {
      name: 'crop';
      fileName: string;
      objectUrl: string;
      natural: { width: number; height: number };
    }
  | { name: 'error'; message: string };

type ImageSize = { width: number; height: number };
type ImageLoader = (objectUrl: string) => Promise<ImageSize>;
type Exporter = (
  image: HTMLImageElement,
  source: ImageSize,
  state: CropState,
  mime: 'image/webp' | 'image/png',
) => Promise<Blob | null>;

/** The browser could not decode the picked file. */
class ImageUnreadable extends Data.TaggedError('ImageUnreadable') {}

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
const defaultImageLoader: ImageLoader = (objectUrl) => Effect.runPromise(loadImageSize(objectUrl));
const defaultExporter: Exporter = (image, source, state, mime) =>
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
const previewUrlFor = (file: File): Effect.Effect<string> =>
  typeof URL.createObjectURL === 'function'
    ? Effect.try(() => URL.createObjectURL(file)).pipe(Effect.orElseSucceed(syntheticPreviewUrl))
    : Effect.sync(syntheticPreviewUrl);

/** Best effort: a refused revoke is ignored. */
const revokePreviewUrl = (url: string): Effect.Effect<void> =>
  url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function'
    ? Effect.ignore(Effect.try(() => URL.revokeObjectURL(url)))
    : Effect.void;

interface PickedCrop {
  image: HTMLImageElement;
  natural: ImageSize;
  objectUrl: string;
  crop: CropState;
}

/** WebP first, then PNG when the browser cannot encode WebP. A null result means neither. */
const exportAvatarFile = (
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

/**
 * Reusable avatar picker (T-0165): choose a file (or drop one), crop it in
 * a dialog with a circular mask, a zoom slider and drag to position,
 * export a 256 x 256 WebP (PNG when the browser cannot encode WebP), Save
 * with a busy state, and Remove. The server validates everything again;
 * this only gets the file ready so the upload rarely fails.
 *
 * `imageLoader`/`exporter` are injectable so tests use fakes and never
 * touch `Image` or `<canvas>`. Production passes the browser defaults.
 */
export function AvatarUploader({
  kind,
  ownerId,
  ownerName,
  currentUrl,
  onChanged,
  imageLoader = defaultImageLoader,
  exporter = defaultExporter,
}: AvatarUploaderProps & {
  imageLoader?: ImageLoader;
  exporter?: Exporter;
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [message, setMessage] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  // Each user action is one Effect. A new pick replaces a pick still loading
  // (the replaced preview URL is revoked on interrupt). Save and Remove drop a
  // second click while the first one waits, so `busy` is the waiting state.
  const [, runLoad] = useAction((load: Effect.Effect<void>) => load, { mode: 'replace' });
  const [saveState, runSave] = useAction((save: Effect.Effect<void>) => save);
  const [removeState, runRemove] = useAction((remove: Effect.Effect<void>) => remove);
  const busy = isWaiting(saveState) || isWaiting(removeState);

  // The crop object URL is revoked when the dialog closes (cancel, save
  // or a failed save): every path out of the crop phase revokes it, so no
  // effect is needed.

  const pick = useCallback(
    (file: File | undefined): void => {
      if (file === undefined) {
        return;
      }
      setMessage(undefined);
      if (!ACCEPTED_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
        setPhase({
          name: 'error',
          message: 'That file is not an image. Choose a PNG, JPEG, WebP or GIF.',
        });
        return;
      }
      if (file.size > MAX_LOAD_BYTES) {
        setPhase({
          name: 'error',
          message: 'That file is too large to load. Try one under 20 MB.',
        });
        return;
      }
      const unreadable = (objectUrl: string): Effect.Effect<void> =>
        revokePreviewUrl(objectUrl).pipe(
          Effect.andThen(
            Effect.sync(() =>
              setPhase({
                name: 'error',
                message: 'That image could not be read. Try another file.',
              }),
            ),
          ),
        );
      runLoad(
        previewUrlFor(file).pipe(
          Effect.flatMap((objectUrl) =>
            Effect.tryPromise({
              try: () => imageLoader(objectUrl),
              catch: () => new ImageUnreadable(),
            }).pipe(
              Effect.matchEffect({
                onSuccess: (natural) =>
                  natural.width <= 0 || natural.height <= 0
                    ? unreadable(objectUrl)
                    : Effect.sync(() => {
                        setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
                        setPhase({ name: 'crop', fileName: file.name, objectUrl, natural });
                      }),
                onFailure: () => unreadable(objectUrl),
              }),
              Effect.onInterrupt(() => revokePreviewUrl(objectUrl)),
            ),
          ),
        ),
      );
    },
    [imageLoader, runLoad],
  );

  // Save: export, upload, then hand the new URL to the parent. A failure at
  // any step shows its sentence in the error phase, as before.
  const saveCrop = (picked: PickedCrop): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.sync(() => setMessage(undefined));
      const file = yield* exportAvatarFile(exporter, picked);
      if (file === null) {
        yield* Effect.sync(() =>
          setPhase({
            name: 'error',
            message: 'The picture could not be prepared. Try another file.',
          }),
        );
        return;
      }
      const { url } = yield* Effect.tryPromise({
        try: () => uploadAvatar(kind, ownerId, file),
        catch: (cause) => cause,
      });
      yield* revokePreviewUrl(picked.objectUrl);
      yield* Effect.sync(() => {
        setPhase({ name: 'idle' });
        onChanged(url);
      });
    }).pipe(
      Effect.matchEffect({
        onSuccess: () => Effect.void,
        onFailure: (cause) =>
          Effect.sync(() => setPhase({ name: 'error', message: friendlyUploadError(cause) })),
      }),
    );

  const onSave = (): void => {
    const image = imageRef.current;
    if (phase.name !== 'crop' || image === null) {
      return;
    }
    runSave(saveCrop({ image, natural: phase.natural, objectUrl: phase.objectUrl, crop }));
  };

  const onRemove = (): void => {
    runRemove(
      Effect.sync(() => setMessage(undefined)).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => removeAvatar(kind, ownerId),
            catch: (cause) => cause,
          }),
        ),
        Effect.matchEffect({
          onSuccess: () => Effect.sync(() => onChanged(undefined)),
          onFailure: (cause) => Effect.sync(() => setMessage(friendlyUploadError(cause))),
        }),
      ),
    );
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (phase.name !== 'crop') {
      return;
    }
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: crop.offsetX,
      offsetY: crop.offsetY,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (phase.name !== 'crop' || dragRef.current === null) {
      return;
    }
    const start = dragRef.current;
    setCrop((current) => {
      const next = {
        ...current,
        offsetX: start.offsetX + (event.clientX - start.x),
        offsetY: start.offsetY + (event.clientY - start.y),
      };
      const clamped = clampOffset(phase.natural, next);
      return { ...next, ...clamped };
    });
  };

  const onPointerUp = (): void => {
    dragRef.current = null;
  };

  const closeCrop = (): void => {
    if (phase.name === 'crop') {
      Effect.runSync(revokePreviewUrl(phase.objectUrl));
    }
    setPhase({ name: 'idle' });
  };

  const fitted = phase.name === 'crop' ? fitInView(phase.natural) : null;
  const zoomed =
    fitted === null || phase.name !== 'crop'
      ? null
      : { width: fitted.width * crop.zoom, height: fitted.height * crop.zoom };

  return (
    <section aria-label={`${ownerName} picture`} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Avatar id={ownerId} name={ownerName} size={64} ai={kind === 'ai'} avatarUrl={currentUrl} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
            {currentUrl === undefined ? 'Add picture' : 'Change picture'}
          </Button>
          {currentUrl !== undefined && (
            <Button type="button" variant="outline" onClick={onRemove} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label="Choose a picture file"
        className="hidden"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {message !== undefined && (
        <p role="alert" className="text-[14px] text-danger">
          {message}
        </p>
      )}
      {phase.name === 'error' && (
        <p role="alert" className="text-[14px] text-danger">
          {phase.message}{' '}
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setPhase({ name: 'idle' })}
            className="h-auto px-0 text-inherit"
          >
            Dismiss
          </Button>
        </p>
      )}
      {phase.name === 'crop' && fitted !== null && zoomed !== null && (
        <Dialog
          open
          onClose={closeCrop}
          title="Crop your picture"
          size="sm"
          dismissable={!busy}
          actions={
            <>
              <Button type="button" variant="ghost" onClick={closeCrop} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={onSave} disabled={busy}>
                {busy ? 'Saving…' : 'Save picture'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative touch-none overflow-hidden rounded-full bg-surface-raised select-none"
              style={{
                width: AVATAR_CROP_VIEW_SIDE,
                height: AVATAR_CROP_VIEW_SIDE,
                maxWidth: '100%',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* The fitted image, zoomed and dragged under the circular
                  mask (the container clips to a circle). */}
              <img
                ref={imageRef}
                src={phase.objectUrl}
                alt=""
                draggable={false}
                className="absolute top-1/2 left-1/2 max-w-none"
                style={{
                  width: zoomed.width,
                  height: zoomed.height,
                  transform: `translate(calc(-50% + ${crop.offsetX}px), calc(-50% + ${crop.offsetY}px))`,
                }}
              />
            </div>
            <label className="flex w-full items-center gap-2 text-[14px]" htmlFor="avatar-zoom">
              Zoom
              <input
                id="avatar-zoom"
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={crop.zoom}
                disabled={busy}
                onChange={(event) => {
                  const zoom = clampZoom(Number(event.target.value));
                  setCrop((current) => {
                    const clamped = clampOffset(phase.natural, { ...current, zoom });
                    return { ...current, zoom, ...clamped };
                  });
                }}
                className="w-full accent-white"
              />
            </label>
            <p className="text-[13px] text-muted-foreground">
              Drag to position · exports 256 × 256
            </p>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function friendlyUploadError(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    switch (code) {
      case 'avatar_empty':
        return 'The picture file is empty.';
      case 'avatar_too_large':
        return 'The picture is larger than 256 KiB. Try a smaller file.';
      case 'avatar_animated':
        return 'The picture must be a still image, not an animation.';
      case 'avatar_not_square':
        return 'The picture must be square.';
      case 'avatar_bad_size':
        return 'The picture must be between 64 and 512 pixels on each side.';
      case 'avatar_not_image':
        return 'That file is not a supported picture. Choose a PNG or WebP image.';
      case 'rate_limited':
        return 'Too many uploads — wait a little and try again.';
      case 'network_error':
        return 'Could not reach the server. Try again.';
      default:
        break;
    }
    if (typeof (error as { message?: unknown }).message === 'string') {
      return (error as unknown as { message: string }).message;
    }
  }
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'Could not save the picture. Try again.';
}
