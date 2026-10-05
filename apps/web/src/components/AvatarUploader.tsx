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

async function loadImageSize(objectUrl: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = (): void => resolve();
    image.onerror = (): void => reject(new Error('decode'));
  });
  image.src = objectUrl;
  await loaded;
  return { width: image.naturalWidth, height: image.naturalHeight };
}

function encodeExport(
  image: HTMLImageElement,
  source: { width: number; height: number },
  state: CropState,
  mime: 'image/webp' | 'image/png',
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_EXPORT_SIDE;
  canvas.height = AVATAR_EXPORT_SIDE;
  const context = canvas.getContext('2d');
  if (context === null) {
    return Promise.resolve(null);
  }
  const args = exportDrawArgs(source, state);
  context.drawImage(image, args.sx, args.sy, args.sSide, args.sSide, 0, 0, args.dSide, args.dSide);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, mime === 'image/webp' ? 0.92 : undefined);
  });
}

// jsdom (and some test environments) has no `URL.createObjectURL`: fall
// back to a synthetic url the injected `imageLoader` fake ignores. The
// `<img>` still gets a `src`, so production behaviour is unchanged.
let previewCounter = 0;

function createPreviewUrl(file: File): string {
  if (typeof URL.createObjectURL === 'function') {
    try {
      return URL.createObjectURL(file);
    } catch {
      // Fall through to the synthetic url below.
    }
  }
  previewCounter += 1;
  return `avatar-preview-${previewCounter}`;
}

function revokePreviewUrl(url: string): void {
  if (url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Best effort only.
    }
  }
}

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
  imageLoader = loadImageSize,
  exporter = encodeExport,
}: AvatarUploaderProps & {
  imageLoader?: (objectUrl: string) => Promise<{ width: number; height: number }>;
  exporter?: (
    image: HTMLImageElement,
    source: { width: number; height: number },
    state: CropState,
    mime: 'image/webp' | 'image/png',
  ) => Promise<Blob | null>;
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

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
      const objectUrl = createPreviewUrl(file);
      void imageLoader(objectUrl).then(
        (natural) => {
          if (natural.width <= 0 || natural.height <= 0) {
            revokePreviewUrl(objectUrl);
            setPhase({ name: 'error', message: 'That image could not be read. Try another file.' });
            return;
          }
          setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
          setPhase({ name: 'crop', fileName: file.name, objectUrl, natural });
        },
        () => {
          revokePreviewUrl(objectUrl);
          setPhase({ name: 'error', message: 'That image could not be read. Try another file.' });
        },
      );
    },
    [imageLoader],
  );

  const save = useCallback(async (): Promise<void> => {
    if (phase.name !== 'crop' || imageRef.current === null || busy) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const image = imageRef.current;
      let blob = await exporter(image, phase.natural, crop, 'image/webp');
      let type: 'image/webp' | 'image/png' = 'image/webp';
      if (blob === null) {
        blob = await exporter(image, phase.natural, crop, 'image/png');
        type = 'image/png';
      }
      if (blob === null) {
        setPhase({
          name: 'error',
          message: 'The picture could not be prepared. Try another file.',
        });
        return;
      }
      const typed = new File([blob], 'avatar', { type });
      const { url } = await uploadAvatar(kind, ownerId, typed);
      revokePreviewUrl(phase.objectUrl);
      setPhase({ name: 'idle' });
      onChanged(url);
    } catch (error) {
      setPhase({ name: 'error', message: friendlyUploadError(error) });
    } finally {
      setBusy(false);
    }
  }, [phase, crop, busy, kind, ownerId, onChanged, exporter]);

  const remove = useCallback(async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await removeAvatar(kind, ownerId);
      onChanged(undefined);
    } catch (error) {
      setMessage(friendlyUploadError(error));
    } finally {
      setBusy(false);
    }
  }, [busy, kind, ownerId, onChanged]);

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
      revokePreviewUrl(phase.objectUrl);
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
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-full border border-border px-4 py-1.5 text-[14px] hover:bg-surface-raised disabled:opacity-60"
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
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
          <button
            type="button"
            onClick={() => setPhase({ name: 'idle' })}
            className="underline hover:no-underline"
          >
            Dismiss
          </button>
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
              <button
                type="button"
                onClick={closeCrop}
                disabled={busy}
                className="rounded-full px-4 py-1.5 text-[14px] text-muted-foreground hover:bg-list-hover disabled:opacity-60"
              >
                Cancel
              </button>
              <Button type="button" onClick={() => void save()} disabled={busy}>
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
