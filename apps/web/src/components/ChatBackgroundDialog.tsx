import type { ChatSummary } from '@zilar/chat-core';
import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  CHAT_BACKGROUND_PRESET_IDS,
  DEFAULT_CHAT_BACKGROUND_PRESET,
  type ChatBackgroundPresetId,
} from '@zilar/ui-tokens';
import {
  deleteBackground,
  listBackgrounds,
  uploadBackground,
  type BackgroundListItem,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { prepareBackgroundImage } from '@/lib/background-image';
import { chatBackgroundStyle, DEFAULT_BACKGROUND_DIM } from '@/lib/chatBackground';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { SegmentedControl } from './ui/segmented-control';

type Scope = 'chat' | 'all';

/** T-0464: the dim slider saves this long after the last change. */
const DIM_SAVE_DELAY_MS = 400;

/** The chat store rejected a write; the dialog shows its fixed sentence. */
class SaveFailed extends Data.TaggedError('SaveFailed') {}

/** A picked image could not be prepared or uploaded; `text` is the fixed sentence. */
class UploadFailed extends Data.TaggedError('UploadFailed')<{ readonly text: string }> {}

/** The image could not be deleted. */
class DeleteFailed extends Data.TaggedError('DeleteFailed') {}

/** One save: an optional wait (the dim slider), then one store write. */
interface SaveRequest {
  readonly delayMs: number;
  readonly write: () => Promise<void>;
}

interface UploadRequest {
  readonly file: File;
  readonly scope: Scope;
}

/** A store write as an Effect: a rejection becomes SaveFailed. */
const writeSave = (write: () => Promise<void>): Effect.Effect<void, SaveFailed> =>
  Effect.tryPromise({ try: write, catch: () => new SaveFailed() });

function presetLabel(id: ChatBackgroundPresetId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** A plain sentence for an upload failure, never the server's text. */
function uploadErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'too_small') {
      return 'This image is too small';
    }
    if (error.message === 'too_large') {
      return 'This image is too large';
    }
  }
  if (error !== null && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (status === 413) {
      return 'This image is too large';
    }
    if (status === 409) {
      return 'You already have 20 images, delete one first';
    }
  }
  return "Couldn't upload the image";
}

/**
 * T-0462/T-0464/T-0466: pick a shared preset (or one of the caller's uploaded
 * images) for this chat, for all chats, or for a group when `groupId` is set,
 * dim an image and delete one. The store paints the choice optimistically; a
 * failed write rolls back and shows a fixed sentence here.
 */
export function ChatBackgroundDialog({
  chat,
  groupId,
  open,
  onClose,
}: {
  chat: ChatSummary;
  /** T-0466: when set, the dialog edits the group's shared background. */
  groupId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const chatKey = chat.id.toLowerCase();
  const chatPref = useChatSelector((s) => s.chatPrefs[chatKey]);
  const defaultBackground = useChatSelector((s) => s.defaultBackground);
  const groupBackgroundStored = useChatSelector((s) => s.groupInfo(chat.id)?.background);
  const setGroupBackground = useChatSelector((s) => s.setGroupBackground);
  const setChatBackground = useChatSelector((s) => s.setChatBackground);
  const setDefaultBackground = useChatSelector((s) => s.setDefaultBackground);
  const setChatBackgroundImage = useChatSelector((s) => s.setChatBackgroundImage);
  const setDefaultBackgroundImage = useChatSelector((s) => s.setDefaultBackgroundImage);
  const [scope, setScope] = useState<Scope>('chat');
  const [error, setError] = useState(false);
  // Images the caller uploaded or deleted since the list was loaded; the list
  // itself comes from `listing` and is reloaded each time the dialog opens.
  const [added, setAdded] = useState<BackgroundListItem[]>([]);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | undefined>(undefined);
  // The slider value while the user drags it: kept next to the image id so a
  // scope or image switch falls back to that image's stored dim during render
  // (no effect needed).
  const [dimDraft, setDimDraft] = useState<{ imageId: string; value: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const chatPreset = chatPref?.backgroundPreset ?? null;
  const chatImageId = chatPref?.backgroundImageId ?? null;
  const defaultPreset = defaultBackground?.backgroundPreset ?? null;
  const defaultImageId = defaultBackground?.backgroundImageId ?? null;
  // T-0466: a group dialog reads the group's shared background; otherwise the
  // scope picks between the chat's own pref and the caller's default.
  const isGroup = groupId !== undefined;
  const groupBackground = isGroup ? groupBackgroundStored : undefined;
  // "This chat" shows the chat's own preset (none when unset); "All chats"
  // shows the caller's default, falling back to slate.
  const selected: string | null = isGroup
    ? (groupBackground?.backgroundPreset ?? null)
    : scope === 'chat'
      ? chatPreset
      : (defaultPreset ?? DEFAULT_CHAT_BACKGROUND_PRESET);
  const selectedImageId = isGroup
    ? (groupBackground?.backgroundImageId ?? null)
    : scope === 'chat'
      ? chatImageId
      : defaultImageId;
  const storedDim = isGroup
    ? (groupBackground?.backgroundDim ?? null)
    : scope === 'chat'
      ? (chatPref?.backgroundDim ?? null)
      : (defaultBackground?.backgroundDim ?? null);
  // A live drag wins while it names the selected image; otherwise the stored
  // dim (or 40) shows.
  const dim =
    dimDraft !== null && dimDraft.imageId === selectedImageId
      ? dimDraft.value
      : (storedDim ?? DEFAULT_BACKGROUND_DIM);

  // A store write; a rejection shows the save sentence. Each save starts by
  // clearing the previous save error.
  const persist = (write: () => Promise<void>): Effect.Effect<void> =>
    Effect.sync(() => setError(false)).pipe(
      Effect.andThen(writeSave(write)),
      Effect.catchTag('SaveFailed', () => Effect.sync(() => setError(true))),
    );

  const writePreset = (presetId: string | null): Promise<void> => {
    if (isGroup) {
      return setGroupBackground(chat.id, {
        backgroundPreset: presetId,
        backgroundImageId: null,
        backgroundDim: null,
      });
    }
    return scope === 'chat' ? setChatBackground(chat.id, presetId) : setDefaultBackground(presetId);
  };

  // `targetScope` is passed in rather than read from the render closure so a
  // timer scheduled under one scope can never write under another.
  const writeImage = (imageId: string, nextDim: number, targetScope: Scope): Promise<void> => {
    if (isGroup) {
      return setGroupBackground(chat.id, {
        backgroundPreset: null,
        backgroundImageId: imageId,
        backgroundDim: nextDim,
      });
    }
    return targetScope === 'chat'
      ? setChatBackgroundImage(chat.id, imageId, nextDim)
      : setDefaultBackgroundImage(imageId, nextDim);
  };

  // The server clears a deleted image from any pref that referenced it; the
  // store is patched to match so the chat stops painting the now-404 URL.
  const clearDeletedSelection = (id: string): Effect.Effect<void, SaveFailed> => {
    if (isGroup) {
      return groupBackground?.backgroundImageId === id
        ? writeSave(() =>
            setGroupBackground(chat.id, {
              backgroundPreset: null,
              backgroundImageId: null,
              backgroundDim: null,
            }),
          )
        : Effect.void;
    }
    const clearChat: Effect.Effect<void, SaveFailed> =
      chatImageId === id ? writeSave(() => setChatBackground(chat.id, null)) : Effect.void;
    const clearDefault: Effect.Effect<void, SaveFailed> =
      defaultImageId === id ? writeSave(() => setDefaultBackground(null)) : Effect.void;
    return clearChat.pipe(Effect.andThen(clearDefault));
  };

  // Load the caller's images each time the dialog opens. A failure leaves the
  // list empty, so the section still offers Upload.
  const [listing] = useQuery(
    (): Effect.Effect<BackgroundListItem[]> =>
      open
        ? fromApi(() => listBackgrounds()).pipe(
            Effect.catchTag('ApiFailure', () => Effect.succeed([])),
          )
        : Effect.succeed([]),
    [open],
  );
  const listed = AsyncResult.isSuccess(listing) ? listing.value : [];
  // Deleted rows stay in the list (they render nothing), so their delete runs to the end.
  const images = [...added, ...listed];
  const shownIds = images.filter((row) => !removedIds.has(row.id)).map((row) => row.id);

  // Saves run one at a time: a newer save replaces the one waiting or in flight,
  // so a dim change cancels its pending save and a picked preset cancels it too.
  const [, runSave, saveControls] = useAction(
    (request: SaveRequest) =>
      (request.delayMs > 0 ? Effect.sleep(request.delayMs) : Effect.void).pipe(
        Effect.andThen(persist(request.write)),
      ),
    { mode: 'replace' },
  );

  // A picked file is prepared, uploaded, added to the list and selected for
  // the scope it was picked under. A second pick while one waits is ignored.
  const [uploadState, runUpload] = useAction(({ file, scope: targetScope }: UploadRequest) =>
    Effect.tryPromise({
      try: () => prepareBackgroundImage(file),
      catch: (cause) => new UploadFailed({ text: uploadErrorMessage(cause) }),
    }).pipe(
      Effect.flatMap((blob) =>
        Effect.tryPromise({
          try: () => uploadBackground(blob),
          catch: (cause) => new UploadFailed({ text: uploadErrorMessage(cause) }),
        }),
      ),
      Effect.tap((uploaded) =>
        Effect.sync(() =>
          setAdded((current) => [
            {
              id: uploaded.id,
              url: uploaded.url,
              width: uploaded.width,
              height: uploaded.height,
              createdAt: new Date().toISOString(),
            },
            ...current,
          ]),
        ),
      ),
      // A fresh upload becomes the look for the scope it was picked under.
      Effect.tap((uploaded) =>
        persist(() => writeImage(uploaded.id, DEFAULT_BACKGROUND_DIM, targetScope)),
      ),
      Effect.tapError((failure) => Effect.sync(() => setUploadError(failure.text))),
    ),
  );
  const busy = isWaiting(uploadState);

  // One delete: the file goes, the dim draft for it is dropped and the store is
  // patched when the image was selected. Each row runs its own copy (BackgroundRow).
  // The whole unit is uninterruptible: closing the dialog unmounts the row, and
  // the store patch must still run so the chat stops pointing at the deleted file.
  const deleteImage = (id: string): Effect.Effect<void> =>
    Effect.uninterruptible(
      Effect.tryPromise({ try: () => deleteBackground(id), catch: () => new DeleteFailed() }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setRemovedIds((ids) => new Set(ids).add(id));
            setDimDraft((draft) => (draft !== null && draft.imageId === id ? null : draft));
          }),
        ),
        Effect.andThen(clearDeletedSelection(id)),
        Effect.catchTag('SaveFailed', () => Effect.sync(() => setError(true))),
        Effect.catchTag('DeleteFailed', () =>
          Effect.sync(() => setUploadError("Couldn't delete the image")),
        ),
      ),
    );

  // Picking a preset clears any image, so a pending dim save for the image it
  // replaces is dropped too: the save below replaces it.
  const choose = (presetId: string | null): void => {
    setDimDraft(null);
    runSave({ delayMs: 0, write: () => writePreset(presetId) });
  };

  const selectImage = (imageId: string, nextDim: number, targetScope: Scope): void => {
    runSave({ delayMs: 0, write: () => writeImage(imageId, nextDim, targetScope) });
  };

  const changeDim = (value: number): void => {
    if (selectedImageId === null) {
      return;
    }
    const imageId = selectedImageId;
    const targetScope = scope;
    setDimDraft({ imageId, value });
    runSave({ delayMs: DIM_SAVE_DELAY_MS, write: () => writeImage(imageId, value, targetScope) });
  };

  const startUpload = (file: File | undefined): void => {
    if (file === undefined || busy) {
      return;
    }
    saveControls.reset();
    setUploadError(undefined);
    runUpload({ file, scope });
  };

  // Starts a confirmed delete: the confirm row closes and a pending dim save is dropped.
  const startDelete = (): void => {
    setConfirmId(undefined);
    setUploadError(undefined);
    saveControls.reset();
  };

  // Each open starts clean: the previous scope, the uploads and deletes and a
  // stale save error must not carry over to the next time the dialog is shown.
  const close = (): void => {
    saveControls.reset();
    setError(false);
    setUploadError(undefined);
    setConfirmId(undefined);
    setDimDraft(null);
    setAdded([]);
    setRemovedIds(new Set());
    setScope('chat');
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog open={open} onClose={close} title={isGroup ? 'Group background' : 'Chat background'}>
      {!isGroup && (
        <SegmentedControl
          options={[
            { value: 'chat', label: 'This chat' },
            { value: 'all', label: 'All chats' },
          ]}
          value={scope}
          onChange={(value) => {
            saveControls.reset();
            setDimDraft(null);
            setError(false);
            setScope(value === 'all' ? 'all' : 'chat');
          }}
          ariaLabel="Background scope"
          mode="radio"
        />
      )}
      <div className="mt-4 grid grid-cols-4 gap-3">
        {CHAT_BACKGROUND_PRESET_IDS.map((id) => {
          const isSelected = selected === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={presetLabel(id)}
              aria-pressed={isSelected}
              onClick={() => choose(id)}
              className={cn(
                'chat-background relative aspect-square rounded-[10px] border transition-shadow',
                isSelected ? 'border-accent ring-2 ring-accent/40' : 'border-border',
              )}
              style={chatBackgroundStyle({ kind: 'preset', id })}
            >
              {isSelected && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Check className="size-5 text-white" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>
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
              onPick={() => selectImage(image.id, storedDim ?? DEFAULT_BACKGROUND_DIM, scope)}
              onAskDelete={() => setConfirmId(image.id)}
              onCancelDelete={() => setConfirmId(undefined)}
              onStartDelete={startDelete}
              deleteImage={deleteImage}
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
            startUpload(event.target.files?.[0]);
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
              onChange={(event) => changeDim(Number(event.target.value))}
              className="w-full accent-white"
            />
            <span className="w-8 text-right text-muted-foreground">{dim}%</span>
          </label>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => choose(null)}
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          {isGroup ? 'No group background' : 'Use default'}
        </button>
        {error && (
          <span role="alert" className="text-[12px] text-danger">
            Couldn&apos;t save the background
          </span>
        )}
      </div>
    </Dialog>
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
