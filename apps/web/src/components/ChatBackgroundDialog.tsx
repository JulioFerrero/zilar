import { BackgroundImages } from './background/BackgroundImages';
import {
  DIM_SAVE_DELAY_MS,
  DeleteFailed,
  type SaveFailed,
  type SaveRequest,
  type Scope,
  UploadFailed,
  type UploadRequest,
  uploadErrorMessage,
  presetLabel,
  writeSave,
} from './background/backgroundOps';
import { Dialog } from './ui/dialog';
import { SegmentedControl } from './ui/segmented-control';
import {
  deleteBackground,
  listBackgrounds,
  uploadBackground,
  type BackgroundListItem,
  type GroupBackground,
} from '@/lib/api';
import { DEFAULT_BACKGROUND_DIM, chatBackgroundStyle } from '@/lib/chatBackground';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import type { ChatSummary } from '@zilar/chat-core';
import { fromApi } from '@zilar/client-core';
import {
  DEFAULT_CHAT_BACKGROUND_PRESET,
  CHAT_BACKGROUND_PRESET_IDS,
  type ChatBackgroundPresetId,
} from '@zilar/ui-tokens';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check } from 'lucide-react';
import { useState } from 'react';

function PresetGrid({
  selected,
  onChoose,
}: {
  selected: string | null;
  onChoose: (id: ChatBackgroundPresetId) => void;
}) {
  return (
    <div className="mt-4 grid grid-cols-4 gap-3">
      {CHAT_BACKGROUND_PRESET_IDS.map((id) => {
        const isSelected = selected === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={presetLabel(id)}
            aria-pressed={isSelected}
            onClick={() => onChoose(id)}
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
  );
}

interface BackgroundWriteDeps {
  readonly chatId: string;
  readonly isGroup: boolean;
  readonly scope: Scope;
  readonly groupBackground: GroupBackground | undefined;
  readonly chatImageId: string | null;
  readonly defaultImageId: string | null;
  readonly setError: (value: boolean) => void;
  readonly setGroupBackground: (chatId: string, background: GroupBackground) => Promise<void>;
  readonly setChatBackground: (chatId: string, presetId: string | null) => Promise<void>;
  readonly setDefaultBackground: (presetId: string | null) => Promise<void>;
  readonly setChatBackgroundImage: (chatId: string, imageId: string, dim: number) => Promise<void>;
  readonly setDefaultBackgroundImage: (imageId: string, dim: number) => Promise<void>;
}

interface BackgroundWrites {
  persist: (write: () => Promise<void>) => Effect.Effect<void>;
  writePreset: (presetId: string | null) => Promise<void>;
  writeImage: (imageId: string, nextDim: number, targetScope: Scope) => Promise<void>;
  clearDeletedSelection: (id: string) => Effect.Effect<void, SaveFailed>;
}

function createBackgroundWrites({
  chatId,
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
}: BackgroundWriteDeps): BackgroundWrites {
  const persist = (write: () => Promise<void>): Effect.Effect<void> =>
    Effect.sync(() => setError(false)).pipe(
      Effect.andThen(writeSave(write)),
      Effect.catchTag('SaveFailed', () => Effect.sync(() => setError(true))),
    );

  const writePreset = (presetId: string | null): Promise<void> => {
    if (isGroup) {
      return setGroupBackground(chatId, {
        backgroundPreset: presetId,
        backgroundImageId: null,
        backgroundDim: null,
      });
    }
    return scope === 'chat' ? setChatBackground(chatId, presetId) : setDefaultBackground(presetId);
  };

  // `targetScope` is passed in rather than read from the render closure, so a
  // timer scheduled under one scope can never write under another.
  const writeImage = (imageId: string, nextDim: number, targetScope: Scope): Promise<void> => {
    if (isGroup) {
      return setGroupBackground(chatId, {
        backgroundPreset: null,
        backgroundImageId: imageId,
        backgroundDim: nextDim,
      });
    }
    return targetScope === 'chat'
      ? setChatBackgroundImage(chatId, imageId, nextDim)
      : setDefaultBackgroundImage(imageId, nextDim);
  };

  // The server clears a deleted image from any pref that referenced it; patch
  // the store to match so chats stop painting the now-404 URL.
  const clearDeletedSelection = (id: string): Effect.Effect<void, SaveFailed> => {
    if (isGroup) {
      return groupBackground?.backgroundImageId === id
        ? writeSave(() =>
            setGroupBackground(chatId, {
              backgroundPreset: null,
              backgroundImageId: null,
              backgroundDim: null,
            }),
          )
        : Effect.void;
    }
    const clearChat: Effect.Effect<void, SaveFailed> =
      chatImageId === id ? writeSave(() => setChatBackground(chatId, null)) : Effect.void;
    const clearDefault: Effect.Effect<void, SaveFailed> =
      defaultImageId === id ? writeSave(() => setDefaultBackground(null)) : Effect.void;
    return clearChat.pipe(Effect.andThen(clearDefault));
  };

  return { persist, writePreset, writeImage, clearDeletedSelection };
}

export function ChatBackgroundDialog({
  chat,
  groupId,
  open,
  onClose,
}: {
  chat: ChatSummary;
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
  const [added, setAdded] = useState<BackgroundListItem[]>([]);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | undefined>(undefined);
  const [dimDraft, setDimDraft] = useState<{ imageId: string; value: number } | null>(null);

  const chatPreset = chatPref?.backgroundPreset ?? null;
  const chatImageId = chatPref?.backgroundImageId ?? null;
  const defaultPreset = defaultBackground?.backgroundPreset ?? null;
  const defaultImageId = defaultBackground?.backgroundImageId ?? null;
  const isGroup = groupId !== undefined;
  const groupBackground = isGroup ? groupBackgroundStored : undefined;
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
  const images = [...added, ...listed];
  const shownIds = images.filter((row) => !removedIds.has(row.id)).map((row) => row.id);

  // Saves run one at a time: a newer save replaces the waiting or in-flight one.
  const [, runSave, saveControls] = useAction(
    (request: SaveRequest) =>
      (request.delayMs > 0 ? Effect.sleep(request.delayMs) : Effect.void).pipe(
        Effect.andThen(persist(request.write)),
      ),
    { mode: 'replace' },
  );

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
      Effect.tap((uploaded) =>
        persist(() => writeImage(uploaded.id, DEFAULT_BACKGROUND_DIM, targetScope)),
      ),
      Effect.tapError((failure) => Effect.sync(() => setUploadError(failure.text))),
    ),
  );
  const busy = isWaiting(uploadState);

  // Each row deletes on its own; the store patch must still run after the
  // dialog unmounts so the chat stops pointing at the deleted file.
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

  const startDelete = (): void => {
    setConfirmId(undefined);
    setUploadError(undefined);
    saveControls.reset();
  };

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
    <Dialog
      open={open}
      onClose={close}
      title={isGroup ? 'Group background' : 'Chat background'}
      busy={busy}
      {...(error ? { error: "Couldn't save the background" } : {})}
    >
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
      <div className="mt-4">
        <button
          type="button"
          onClick={() => choose(null)}
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          {isGroup ? 'No group background' : 'Use default'}
        </button>
      </div>
    </Dialog>
  );
}

/** The smallest side the server accepts (backgrounds run 64-2048 px). */
const BACKGROUND_MIN_SIDE = 64;
/** The largest side the server accepts; the client scales down to fit. */
const BACKGROUND_MAX_SIDE = 2048;
/** The server's upload cap. */
const BACKGROUND_MAX_BYTES = 1024 * 1024;
/** WebP qualities tried in order until the result fits. */
const BACKGROUND_QUALITIES = [0.85, 0.7, 0.5];

interface BackgroundSize {
  width: number;
  height: number;
}

interface LoadedBackground {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** Scales a size down so its largest side is at most max, keeping the ratio; never up,
 * never fractional or zero. */
function fitWithin(width: number, height: number, max = BACKGROUND_MAX_SIDE): BackgroundSize {
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

/** Throws 'too_small' or 'too_large' so the caller can show a plain sentence; a rejection
 * from an injected load or encode passes through unchanged. */
function prepareBackgroundImage(
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
