import { Effect } from 'effect';
import { useCallback, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { removeAvatar, uploadAvatar } from '@/lib/api';
import type { CropState } from '@/lib/avatar-crop';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { applyCrop, CropDialog } from './avatar/CropDialog';
import { friendlyUploadError } from './avatar/avatarErrors';
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
                        setCrop(applyCrop(natural, { zoom: 1, offsetX: 0, offsetY: 0 }));
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

  const closeCrop = (): void => {
    if (phase.name === 'crop') {
      Effect.runSync(revokePreviewUrl(phase.objectUrl));
    }
    setPhase({ name: 'idle' });
  };

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
      {phase.name === 'crop' && (
        <CropDialog
          crop={crop}
          natural={phase.natural}
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
