import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { DEFAULT_CHAT_BACKGROUND_PRESET } from '@zilar/ui-tokens';
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
import { DEFAULT_BACKGROUND_DIM } from '@/lib/chatBackground';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { BackgroundImages } from './background/BackgroundImages';
import { createBackgroundWrites } from './background/backgroundWrites';
import {
  DIM_SAVE_DELAY_MS,
  DeleteFailed,
  type SaveRequest,
  type Scope,
  UploadFailed,
  type UploadRequest,
  uploadErrorMessage,
} from './background/backgroundOps';
import { PresetGrid } from './background/PresetGrid';
import { Dialog } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';

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

  const { persist, writePreset, writeImage, clearDeletedSelection } = createBackgroundWrites({
    chatId: chat.id,
    isGroup,
    scope,
    groupBackground,
    chatImageId,
    defaultImageId,
    setError,
    setGroupBackground,
    setChatBackground,
    setDefaultBackground,
    setChatBackgroundImage,
    setDefaultBackgroundImage,
  });

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
      <PresetGrid selected={selected} onChoose={choose} />
      <BackgroundImages
        images={images}
        shownIds={shownIds}
        removedIds={removedIds}
        selectedImageId={selectedImageId}
        storedDim={storedDim}
        scope={scope}
        confirmId={confirmId}
        busy={busy}
        uploadError={uploadError}
        dim={dim}
        onSelectImage={selectImage}
        onAskDelete={setConfirmId}
        onCancelDelete={() => setConfirmId(undefined)}
        onStartDelete={startDelete}
        onDeleteImage={deleteImage}
        onStartUpload={startUpload}
        onChangeDim={changeDim}
      />
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
