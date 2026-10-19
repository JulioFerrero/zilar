import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { removeAvatar, uploadAvatar } from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';
import { avatarIdentity } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { useCallback, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { isWaiting } from '@zilar/client-core';

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

export type AvatarKind = 'user' | 'ai' | 'group';

/** Files the browser refuses to even load: not an image, or absurdly large. */
const MAX_LOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface AvatarUploaderProps {
  kind: AvatarKind;
  ownerId: string;
  ownerName: string;
  currentUrl?: string | undefined;
  onChanged: (url: string | undefined) => void;
}

interface CropDialogProps {
  crop: CropState;
  objectUrl: string;
  busy: boolean;
  imageRef: React.RefObject<HTMLImageElement | null>;
  onCropChange: React.Dispatch<React.SetStateAction<CropState>>;
  onSave: () => void;
  onClose: () => void;
}

function sameArea(current: CropArea | null, next: CropArea): boolean {
  return (
    current !== null &&
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height
  );
}

function CropDialog({
  crop,
  objectUrl,
  busy,
  imageRef,
  onCropChange,
  onSave,
  onClose,
}: CropDialogProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      title="Crop your picture"
      size="sm"
      busy={busy}
      actions={
        <Button type="button" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save picture'}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="relative overflow-hidden rounded-full bg-surface-raised"
          style={{
            width: AVATAR_CROP_VIEW_SIDE,
            height: AVATAR_CROP_VIEW_SIDE,
            maxWidth: '100%',
          }}
        >
          <Cropper
            image={objectUrl}
            crop={crop.crop}
            zoom={crop.zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={AVATAR_MIN_ZOOM}
            maxZoom={AVATAR_MAX_ZOOM}
            zoomWithScroll
            onCropChange={(point) => onCropChange((current) => ({ ...current, crop: point }))}
            onZoomChange={(zoom) => onCropChange((current) => ({ ...current, zoom }))}
            onCropComplete={(_area, areaPixels) =>
              onCropChange((current) =>
                sameArea(current.area, areaPixels) ? current : { ...current, area: areaPixels },
              )
            }
            setImageRef={(ref) => {
              imageRef.current = ref.current;
            }}
          />
        </div>
        <label className="flex w-full items-center gap-2 text-[14px]" htmlFor="avatar-zoom">
          Zoom
          <input
            id="avatar-zoom"
            type="range"
            min={AVATAR_MIN_ZOOM}
            max={AVATAR_MAX_ZOOM}
            step={0.05}
            value={crop.zoom}
            disabled={busy}
            onChange={(event) => {
              const zoom = Number(event.target.value);
              onCropChange((current) => ({ ...current, zoom }));
            }}
            className="w-full accent-white"
          />
        </label>
        <p className="text-[13px] text-muted-foreground">
          Drag to position · scroll or pinch to zoom · exports 256 × 256
        </p>
      </div>
    </Dialog>
  );
}

/**
 * Crops to 256 x 256 WebP (PNG when the browser cannot encode WebP); the
 * server validates everything again.
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
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP_STATE);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const [, runLoad] = useAction((load: Effect.Effect<void>) => load, { mode: 'replace' });
  const [saveState, runSave] = useAction((save: Effect.Effect<void>) => save);
  const [removeState, runRemove] = useAction((remove: Effect.Effect<void>) => remove);
  const busy = isWaiting(saveState) || isWaiting(removeState);

  // Every path out of the crop phase revokes its object URL, so no effect is needed.

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
                        setCrop(INITIAL_CROP_STATE);
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

  const closeCrop = (): void => {
    if (phase.name === 'crop') {
      Effect.runSync(revokePreviewUrl(phase.objectUrl));
    }
    setPhase({ name: 'idle' });
  };

  return (
    <section aria-label={`${ownerName} picture`} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Avatar
          seed={avatarIdentity({ name: ownerName, id: ownerId }).seed}
          name={ownerName}
          size={64}
          ai={kind === 'ai'}
          avatarUrl={currentUrl}
        />
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
      {phase.name === 'crop' && (
        <CropDialog
          crop={crop}
          objectUrl={phase.objectUrl}
          busy={busy}
          imageRef={imageRef}
          onCropChange={setCrop}
          onSave={onSave}
          onClose={closeCrop}
        />
      )}
    </section>
  );
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

class ImageUnreadable extends Data.TaggedError('ImageUnreadable') {}

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

// The injectable props keep their Promise types (the tests pass Promise fakes),
// so the browser defaults run their Effects at this edge.
const defaultImageLoader: ImageLoader = (objectUrl) => Effect.runPromise(loadImageSize(objectUrl));
const defaultExporter: Exporter = (image, source, state, mime) =>
  Effect.runPromise(encodeAvatar(image, source, state, mime));

// jsdom (and some test environments) has no `URL.createObjectURL`: fall back
// to a synthetic url the injected `imageLoader` fake ignores. The `<img>` still
// gets a `src`, so production behaviour is unchanged.
let previewCounter = 0;

const syntheticPreviewUrl = (): string => {
  previewCounter += 1;
  return `avatar-preview-${previewCounter}`;
};

const previewUrlFor = (file: File): Effect.Effect<string> =>
  typeof URL.createObjectURL === 'function'
    ? Effect.try(() => URL.createObjectURL(file)).pipe(Effect.orElseSucceed(syntheticPreviewUrl))
    : Effect.sync(syntheticPreviewUrl);

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

const AVATAR_EXPORT_SIDE = 256;
/** The crop dialog's preview box is square; the source fits inside it. */
const AVATAR_CROP_VIEW_SIDE = 320;
const AVATAR_MIN_ZOOM = 1;
const AVATAR_MAX_ZOOM = 4;

interface CropSource {
  width: number;
  height: number;
}

/** The visible crop area in source-image pixels, as react-easy-crop reports it. */
interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropState {
  crop: { x: number; y: number };
  /** Zoom factor: 1 shows the whole image, higher zooms in. */
  zoom: number;
  /** The visible crop area in source pixels; null until the Cropper reports it. */
  area: CropArea | null;
}

const INITIAL_CROP_STATE: CropState = { crop: { x: 0, y: 0 }, zoom: 1, area: null };

/** The drawImage arguments that paint the export: the square the Cropper shows, clamped into
 * the source and scaled up; before any area is reported, the largest centred square. */
function exportDrawArgs(
  source: CropSource,
  state: CropState,
  exportSide: number = AVATAR_EXPORT_SIDE,
): { sx: number; sy: number; sSide: number; dSide: number } {
  const area = state.area;
  const side =
    area === null
      ? Math.max(0, Math.min(source.width, source.height))
      : Math.max(0, Math.min(area.width, area.height, source.width, source.height));
  const x = area === null ? (source.width - side) / 2 : area.x;
  const y = area === null ? (source.height - side) / 2 : area.y;
  const sx = Math.min(Math.max(0, x), Math.max(0, source.width - side));
  const sy = Math.min(Math.max(0, y), Math.max(0, source.height - side));
  return { sx, sy, sSide: side, dSide: exportSide };
}
