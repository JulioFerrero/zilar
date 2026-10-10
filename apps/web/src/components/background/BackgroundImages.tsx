import type { Effect } from 'effect';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import type { BackgroundListItem } from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';
import { DEFAULT_BACKGROUND_DIM } from '@/lib/chatBackground';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import type { Scope } from './backgroundOps';

export function BackgroundImages({
  images,
  shownIds,
  removedIds,
  selectedImageId,
  storedDim,
  scope,
  confirmId,
  busy,
  uploadError,
  dim,
  onSelectImage,
  onAskDelete,
  onCancelDelete,
  onStartDelete,
  onDeleteImage,
  onStartUpload,
  onChangeDim,
}: {
  images: BackgroundListItem[];
  /** Ids of the rows still shown, for the labels. */
  shownIds: string[];
  removedIds: ReadonlySet<string>;
  selectedImageId: string | null;
  storedDim: number | null;
  scope: Scope;
  confirmId: string | undefined;
  busy: boolean;
  uploadError: string | undefined;
  dim: number;
  onSelectImage: (imageId: string, nextDim: number, targetScope: Scope) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  /** Runs when a confirmed delete starts. */
  onStartDelete: () => void;
  onDeleteImage: (id: string) => Effect.Effect<void>;
  onStartUpload: (file: File | undefined) => void;
  onChangeDim: (value: number) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-3">
      <h3 className="text-[13px] font-medium text-muted-foreground">Your images</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {images.map((image) => (
          <BackgroundRow
            key={image.id}
            image={image}
            index={shownIds.indexOf(image.id)}
            removed={removedIds.has(image.id)}
            selected={selectedImageId === image.id}
            confirming={confirmId === image.id}
            onPick={() => onSelectImage(image.id, storedDim ?? DEFAULT_BACKGROUND_DIM, scope)}
            onAskDelete={() => onAskDelete(image.id)}
            onCancelDelete={onCancelDelete}
            onStartDelete={onStartDelete}
            deleteImage={onDeleteImage}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <ImagePlus aria-hidden="true" />
          {busy ? 'Uploading…' : 'Upload image'}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Choose a background image"
        className="hidden"
        onChange={(event) => {
          onStartUpload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {uploadError !== undefined && (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {uploadError}
        </p>
      )}
      {selectedImageId !== null && (
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          Dim
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            aria-label="Dim"
            value={dim}
            onChange={(event) => onChangeDim(Number(event.target.value))}
            className="w-full accent-white"
          />
          <span className="w-8 text-right text-muted-foreground">{dim}%</span>
        </label>
      )}
    </div>
  );
}

/**
 * One uploaded image: a thumbnail, or the inline delete confirm. Each row has
 * its own delete action, so two rows can be deleted at once and a second click
 * on the same row while it waits is ignored. A deleted row stays mounted and
 * renders nothing, so the store patch after its delete still runs to the end
 * (the BlockedPage model, T-0767).
 */
function BackgroundRow({
  image,
  index,
  removed,
  selected,
  confirming,
  onPick,
  onAskDelete,
  onCancelDelete,
  onStartDelete,
  deleteImage,
}: {
  image: BackgroundListItem;
  /** Position among the rows still shown, for the labels. */
  index: number;
  removed: boolean;
  selected: boolean;
  confirming: boolean;
  onPick: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  /** Runs when a confirmed delete starts. */
  onStartDelete: () => void;
  deleteImage: (id: string) => Effect.Effect<void>;
}) {
  const [, runDelete] = useAction((id: string) => deleteImage(id));
  if (removed) {
    return null;
  }
  return (
    <div className="flex items-center">
      {confirming ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-border px-2 py-1">
          <span className="text-[12px]">Delete this image?</span>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onStartDelete();
              runDelete(image.id);
            }}
          >
            Delete
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancelDelete}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            aria-label={`Background image ${index + 1}`}
            aria-pressed={selected}
            onClick={onPick}
            className={cn(
              'block size-14 overflow-hidden rounded-[10px] border transition-shadow',
              selected ? 'border-accent ring-2 ring-accent/40' : 'border-border',
            )}
          >
            <img src={image.url} alt="" className="size-full object-cover" />
          </button>
          <IconButton
            aria-label={`Delete background image ${index + 1}`}
            size={20}
            radius={6}
            className="absolute top-0.5 right-0.5"
            onClick={onAskDelete}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
