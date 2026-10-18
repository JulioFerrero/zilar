import {
  defaultExporter,
  defaultImageLoader,
  exportAvatarFile,
  ImageUnreadable,
  previewUrlFor,
  revokePreviewUrl,
  type Exporter,
  type ImageLoader,
  type Phase,
  type PickedCrop,
} from './avatar/avatarImageCodec';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { removeAvatar, uploadAvatar } from '@/lib/api';
import {
  INITIAL_CROP_STATE,
  type CropState,
  AVATAR_CROP_VIEW_SIDE,
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  type CropArea,
} from '@/lib/avatar-crop';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { avatarIdentity } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useCallback, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';

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
