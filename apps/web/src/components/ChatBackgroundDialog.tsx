import type { ChatSummary } from '@zilar/chat-core';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { prepareBackgroundImage } from '@/lib/background-image';
import { chatBackgroundStyle, DEFAULT_BACKGROUND_DIM } from '@/lib/chatBackground';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/ChatStoreProvider';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { IconButton } from './ui/icon-button';
import { SegmentedControl } from './ui/segmented-control';

type Scope = 'chat' | 'all';

/** T-0464: the dim slider saves this long after the last change. */
const DIM_SAVE_DELAY_MS = 400;

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
 * T-0462/T-0464: pick a shared preset (or one of the caller's uploaded
 * images) for this chat or for all chats, dim an image and delete one. The
 * store paints the choice optimistically; a failed write rolls back and shows
 * a fixed sentence here.
 */
export function ChatBackgroundDialog({
  chat,
  open,
  onClose,
}: {
  chat: ChatSummary;
  open: boolean;
  onClose: () => void;
}) {
  const store = useChatStore();
  const [scope, setScope] = useState<Scope>('chat');
  const [error, setError] = useState(false);
  const [images, setImages] = useState<BackgroundListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [confirmId, setConfirmId] = useState<string | undefined>(undefined);
  // The slider value while the user drags it: kept next to the image id so a
  // scope or image switch falls back to that image's stored dim during render
  // (no effect needed).
  const [dimDraft, setDimDraft] = useState<{ imageId: string; value: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A pending dim save must not outlive the scope or image it was made for, so
  // switching scope, switching image, clearing the image or closing cancels it.
  const clearDimTimer = (): void => {
    if (dimTimer.current !== undefined) {
      clearTimeout(dimTimer.current);
      dimTimer.current = undefined;
    }
  };

  const chatKey = chat.id.toLowerCase();
  const chatPref = store.chatPrefs[chatKey];
  const chatPreset = chatPref?.backgroundPreset ?? null;
  const chatImageId = chatPref?.backgroundImageId ?? null;
  const defaultPreset = store.defaultBackground?.backgroundPreset ?? null;
  const defaultImageId = store.defaultBackground?.backgroundImageId ?? null;
  // "This chat" shows the chat's own preset (none when unset); "All chats"
  // shows the caller's default, falling back to slate.
  const selected: string | null =
    scope === 'chat' ? chatPreset : (defaultPreset ?? DEFAULT_CHAT_BACKGROUND_PRESET);
  const selectedImageId = scope === 'chat' ? chatImageId : defaultImageId;
  const storedDim =
    scope === 'chat'
      ? (chatPref?.backgroundDim ?? null)
      : (store.defaultBackground?.backgroundDim ?? null);
  // A live drag wins while it names the selected image; otherwise the stored
  // dim (or 40) shows.
  const dim =
    dimDraft !== null && dimDraft.imageId === selectedImageId
      ? dimDraft.value
      : (storedDim ?? DEFAULT_BACKGROUND_DIM);

  // Load the caller's images each time the dialog opens. A failure leaves the
  // list empty, so the section still offers Upload.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void listBackgrounds().then(
      (rows) => {
        if (!cancelled) {
          setImages(rows);
        }
      },
      () => {
        if (!cancelled) {
          setImages([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (dimTimer.current !== undefined) {
        clearTimeout(dimTimer.current);
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  // Picking a preset clears any image, so a pending dim save for the image it
  // replaces must be dropped too.
  const choose = async (presetId: string | null): Promise<void> => {
    clearDimTimer();
    setDimDraft(null);
    setError(false);
    try {
      if (scope === 'chat') {
        await store.setChatBackground(chat.id, presetId);
      } else {
        await store.setDefaultBackground(presetId);
      }
    } catch {
      setError(true);
    }
  };

  // `targetScope` is passed in rather than read from the render closure so a
  // timer scheduled under one scope can never write under another.
  const selectImage = async (
    imageId: string,
    nextDim: number,
    targetScope: Scope,
  ): Promise<void> => {
    setError(false);
    try {
      if (targetScope === 'chat') {
        await store.setChatBackgroundImage(chat.id, imageId, nextDim);
      } else {
        await store.setDefaultBackgroundImage(imageId, nextDim);
      }
    } catch {
      setError(true);
    }
  };

  const changeDim = (value: number): void => {
    if (selectedImageId === null) {
      return;
    }
    const imageId = selectedImageId;
    const targetScope = scope;
    setDimDraft({ imageId, value });
    clearDimTimer();
    dimTimer.current = setTimeout(() => {
      dimTimer.current = undefined;
      void selectImage(imageId, value, targetScope);
    }, DIM_SAVE_DELAY_MS);
  };

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined || busy) {
      return;
    }
    const targetScope = scope;
    clearDimTimer();
    setBusy(true);
    setUploadError(undefined);
    try {
      const blob = await prepareBackgroundImage(file);
      const uploaded = await uploadBackground(blob);
      setImages((current) => [
        {
          id: uploaded.id,
          url: uploaded.url,
          width: uploaded.width,
          height: uploaded.height,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      // A fresh upload becomes the look for the scope it was picked under.
      await selectImage(uploaded.id, DEFAULT_BACKGROUND_DIM, targetScope);
    } catch (uploadFailure) {
      setUploadError(uploadErrorMessage(uploadFailure));
    } finally {
      setBusy(false);
    }
  };

  // The server clears a deleted image from any pref that referenced it; the
  // store is patched to match so the chat stops painting the now-404 URL.
  const clearDeletedSelection = async (id: string): Promise<void> => {
    if (chatImageId === id) {
      await store.setChatBackground(chat.id, null);
    }
    if (defaultImageId === id) {
      await store.setDefaultBackground(null);
    }
  };

  const confirmDelete = async (id: string): Promise<void> => {
    setConfirmId(undefined);
    setUploadError(undefined);
    clearDimTimer();
    try {
      await deleteBackground(id);
    } catch {
      setUploadError("Couldn't delete the image");
      return;
    }
    setImages((current) => current.filter((row) => row.id !== id));
    setDimDraft((draft) => (draft !== null && draft.imageId === id ? null : draft));
    try {
      await clearDeletedSelection(id);
    } catch {
      setError(true);
    }
  };

  // Each open starts clean: the previous scope, the loaded images and a stale
  // save error must not carry over to the next time the dialog is shown.
  const close = (): void => {
    clearDimTimer();
    setError(false);
    setUploadError(undefined);
    setConfirmId(undefined);
    setDimDraft(null);
    setImages([]);
    setScope('chat');
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title="Chat background">
      <SegmentedControl
        options={[
          { value: 'chat', label: 'This chat' },
          { value: 'all', label: 'All chats' },
        ]}
        value={scope}
        onChange={(value) => {
          clearDimTimer();
          setDimDraft(null);
          setError(false);
          setScope(value === 'all' ? 'all' : 'chat');
        }}
        ariaLabel="Background scope"
        mode="radio"
      />
      <div className="mt-4 grid grid-cols-4 gap-3">
        {CHAT_BACKGROUND_PRESET_IDS.map((id) => {
          const isSelected = selected === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={presetLabel(id)}
              aria-pressed={isSelected}
              onClick={() => void choose(id)}
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
          {images.map((image, index) => (
            <div key={image.id} className="flex items-center">
              {confirmId === image.id ? (
                <div className="flex items-center gap-2 rounded-[10px] border border-border px-2 py-1">
                  <span className="text-[12px]">Delete this image?</span>
                  <Button type="button" size="sm" onClick={() => void confirmDelete(image.id)}>
                    Delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmId(undefined)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    aria-label={`Background image ${index + 1}`}
                    aria-pressed={selectedImageId === image.id}
                    onClick={() => {
                      clearDimTimer();
                      void selectImage(image.id, storedDim ?? DEFAULT_BACKGROUND_DIM, scope);
                    }}
                    className={cn(
                      'block size-14 overflow-hidden rounded-[10px] border transition-shadow',
                      selectedImageId === image.id
                        ? 'border-accent ring-2 ring-accent/40'
                        : 'border-border',
                    )}
                  >
                    <img src={image.url} alt="" className="size-full object-cover" />
                  </button>
                  <IconButton
                    aria-label={`Delete background image ${index + 1}`}
                    size={20}
                    radius={6}
                    className="absolute top-0.5 right-0.5"
                    onClick={() => setConfirmId(image.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </div>
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
            void pickFile(event.target.files?.[0]);
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
          onClick={() => void choose(null)}
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          Use default
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
