import type { ReplyRef } from '@zilar/chat-core';
import { Effect } from 'effect';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { GifChoice } from '../GifPanel';
import type { StickerChoice } from '../StickerPanel';
import type { StoreApi } from '@/store/atomStore';
import type { ChatStoreState } from '@/store/store';
import {
  MAX_ATTACHMENT_BYTES,
  classify,
  gifBlobType,
  objectUrlFor,
  type PendingAttachment,
} from '@/lib/attachments';
import { ComposerFailure, fork } from './useVoiceRecorder';

const GIF_LOAD_FAILED = 'Could not load that GIF. Try another.';
/** Telegram's cap, and the mobile picker's `selectionLimit` (T-1246). */
const MAX_ALBUM_PHOTOS = 10;
const FILE_EMPTY = 'That file is empty.';
const FILE_TOO_LARGE = 'That file is larger than 50 MB.';
const ALBUM_TOO_MANY = 'You can send up to 10 photos at once.';

/** The single inline refusal a chosen file gets, before any request. */
function refusal(file: File): string | undefined {
  if (file.size === 0) {
    return FILE_EMPTY;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return FILE_TOO_LARGE;
  }
  return undefined;
}

/** A file the "Photo or video" picker can produce (or a dropped/pasted one). */
function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

/** How `sendPending` sends the staged files. */
export interface SendPendingOptions {
  /** Send photos one by one instead of as one album ("Send as files"). */
  asFiles?: boolean;
}

export interface ComposerAttachments {
  /** The first staged file, for `canSend` and the single-file preview. */
  attachment: PendingAttachment | undefined;
  /** Every staged file: several photos are sent as one album. */
  attachments: PendingAttachment[];
  /** The object URL of each staged image, aligned with `attachments`. */
  previewUrls: (string | undefined)[];
  setAttachment: Dispatch<SetStateAction<PendingAttachment | undefined>>;
  removeAttachment: (index: number) => void;
  attachmentError: string | undefined;
  setAttachmentError: Dispatch<SetStateAction<string | undefined>>;
  stickerOpen: boolean;
  setStickerOpen: Dispatch<SetStateAction<boolean>>;
  /** True while the send dialog for a media pick is open. */
  attachDialogOpen: boolean;
  /** Closes the send dialog and drops its staged pick. */
  closeAttachDialog: () => void;
  stickerWrapRef: RefObject<HTMLSpanElement | null>;
  onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  /**
   * Stages the chosen files. `media` marks a pick from "Photo or video"
   * (or a drop/paste): a media pick opens the send dialog.
   */
  acceptFiles: (files: readonly File[], options?: { media?: boolean }) => void;
  /** Sends every staged file in order; two or more photos share one album id. */
  sendPending: (options?: SendPendingOptions) => void;
  sendSticker: (sticker: StickerChoice) => void;
  sendGif: (gif: GifChoice) => void;
  reset: () => void;
}

export function useComposerAttachments({
  chatId,
  value,
  replyTo,
  onCancelReply,
  storeApi,
}: {
  chatId: string;
  value: string;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
  storeApi: StoreApi<ChatStoreState>;
}): ComposerAttachments {
  const [staged, setStaged] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  // The sticker toggle button plus the panel: a pointer-down outside this
  // wrapper closes the panel (the panel itself is viewport-fixed, so the
  // Composer subtree cannot contain it).
  const stickerWrapRef = useRef<HTMLSpanElement>(null);
  const attachment = staged[0];

  // The picker, paste and drop all funnel their files through here. An empty
  // or oversized file is refused inline, before any request. An all-photo pick
  // stages up to ten photos as one album; anything else (a file, or a mixed
  // pick) keeps the single-attachment behaviour. A `media` pick (the "Photo or
  // video" entry, a drop or a paste) also opens the send dialog.
  const acceptFiles = useCallback((files: readonly File[], options?: { media?: boolean }): void => {
    setAttachmentError(undefined);
    const chosen = [...files];
    const first = chosen[0];
    if (first === undefined) {
      return;
    }
    const isMedia = options?.media === true && chosen.every(isMediaFile);
    if (!chosen.every((file) => classify(file) === 'image')) {
      const error = refusal(first);
      if (error !== undefined) {
        setAttachmentError(error);
        return;
      }
      setStaged([{ file: first, kind: classify(first) }]);
      setAttachDialogOpen(isMedia);
      return;
    }
    for (const file of chosen) {
      const error = refusal(file);
      if (error !== undefined) {
        setAttachmentError(error);
        return;
      }
    }
    if (chosen.length > MAX_ALBUM_PHOTOS) {
      setAttachmentError(ALBUM_TOO_MANY);
    }
    setStaged(chosen.slice(0, MAX_ALBUM_PHOTOS).map((file) => ({ file, kind: 'image' as const })));
    setAttachDialogOpen(isMedia);
  }, []);

  // The single-file `setAttachment(undefined)` the composer uses still clears
  // the whole strip, so Escape and the preview's Remove keep working.
  const setAttachment: Dispatch<SetStateAction<PendingAttachment | undefined>> = useCallback(
    (update) => {
      setStaged((current) => {
        const next = typeof update === 'function' ? update(current[0]) : update;
        return next === undefined ? [] : [next];
      });
    },
    [],
  );

  const removeAttachment = useCallback(
    (index: number): void => {
      setStaged((current) => current.filter((_, position) => position !== index));
      // Removing the last preview leaves nothing to send: close the dialog.
      if (staged.length <= 1) {
        setAttachDialogOpen(false);
      }
    },
    [staged],
  );

  const previewUrls = useMemo(
    () => staged.map((item) => (item.kind === 'image' ? objectUrlFor(item.file) : undefined)),
    [staged],
  );

  // The preview thumbnails' object URLs are revoked when they are replaced or
  // the composer unmounts, so they never leak.
  useEffect(
    () => () => {
      for (const url of previewUrls) {
        if (url !== undefined) {
          URL.revokeObjectURL(url);
        }
      }
    },
    [previewUrls],
  );

  // A file dropped anywhere on the chat panel (or the page) opens the preview,
  // exactly like the picker; a multi-file drop stages every photo at once.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') === true) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files;
      if (files === undefined || files.length === 0) {
        return;
      }
      event.preventDefault();
      acceptFiles([...files], { media: true });
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [acceptFiles]);

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    const transfer = event.clipboardData;
    if (transfer === undefined) {
      return;
    }
    const files: File[] = [...transfer.files];
    if (files.length === 0) {
      for (let index = 0; index < transfer.items.length; index += 1) {
        const item = transfer.items[index];
        if (item !== undefined && item.kind === 'file') {
          const fromItem = item.getAsFile();
          if (fromItem !== null) {
            files.push(fromItem);
          }
        }
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      acceptFiles(files, { media: true });
    }
  };

  // A pointer-down outside the sticker toggle + panel closes the panel.
  // The toggle button lives inside the wrapper, so clicking it to open
  // never counts as "outside" (it fires before the toggle's click).
  useEffect(() => {
    if (!stickerOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (
        stickerWrapRef.current !== null &&
        event.target instanceof Node &&
        !stickerWrapRef.current.contains(event.target) &&
        document.querySelector('[data-testid="sticker-panel"]')?.contains(event.target) !== true
      ) {
        setStickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [stickerOpen]);

  // A sticker sends at once through the store (same path as other payload
  // messages): optimistic bubble, failure shows the usual retry.
  const sendSticker = useCallback(
    (sticker: StickerChoice): void => {
      storeApi
        .getState()
        .sendSticker(chatId, sticker, replyTo === undefined ? undefined : { replyTo });
      setStickerOpen(false);
      onCancelReply();
    },
    [chatId, onCancelReply, replyTo, storeApi],
  );

  // A GIF pick fetches the media through the proxy, then uploads it with the
  // existing attachment path and sends an attachment message (T-0122): the
  // sent GIF is stored as our attachment and keeps working if the provider
  // disappears. A caption is whatever the composer holds. The mime and the
  // extension come from the proxied blob's real content type (validated
  // against what the proxy serves), never from the search result's kind.
  // Failures show the inline error; the attachment bubble's Retry covers
  // upload failures.
  const sendGif = useCallback(
    (gif: GifChoice): void => {
      const caption = value.trim();
      setStickerOpen(false);
      onCancelReply();
      setAttachmentError(undefined);
      const loadFailed = (): ComposerFailure => new ComposerFailure({ message: GIF_LOAD_FAILED });
      fork(
        Effect.tryPromise({
          try: (signal) => fetch(gif.url, { credentials: 'same-origin', signal }),
          catch: loadFailed,
        }).pipe(
          // The proxy refused the media.
          Effect.filterOrFail((response) => response.ok, loadFailed),
          Effect.flatMap((response) =>
            Effect.tryPromise({ try: () => response.blob(), catch: loadFailed }),
          ),
          Effect.filterOrFail((blob) => blob.size > 0, loadFailed),
          Effect.flatMap((blob) =>
            Effect.sync(() => {
              const { mime, extension } = gifBlobType(blob.type, gif.kind);
              const file = new File([blob], `gif-${gif.id.slice(0, 16)}.${extension}`, {
                type: mime,
              });
              storeApi.getState().sendAttachment(chatId, file, {
                ...(caption.length === 0 ? {} : { caption }),
                ...(replyTo === undefined ? {} : { replyTo }),
              });
            }),
          ),
          Effect.catchTag('ComposerFailure', (failure) =>
            Effect.sync(() => setAttachmentError(failure.message)),
          ),
        ),
      );
    },
    [chatId, onCancelReply, replyTo, storeApi, value],
  );

  // Sends every staged file in order. Two or more photos get one album id
  // (`urn:zilar:album:0`), each with its `index`, and only the first carries
  // the caption and the reply. Uploads then run in parallel and the list renders
  // by `index`. "Send as files" drops the album marker so each photo is its own
  // message (the app never compresses, so the bytes are the same).
  const sendPending = useCallback(
    (options?: SendPendingOptions): void => {
      const store = storeApi.getState();
      const caption = value.trim();
      const asFiles = options?.asFiles === true;
      const count = asFiles ? 0 : staged.filter((item) => item.kind === 'image').length;
      const albumId = count >= 2 ? crypto.randomUUID() : undefined;
      let imageIndex = 0;
      staged.forEach((item, index) => {
        const isImage = item.kind === 'image';
        store.sendAttachment(chatId, item.file, {
          ...(index === 0 && caption.length > 0 ? { caption } : {}),
          ...(index === 0 && replyTo !== undefined ? { replyTo } : {}),
          ...(isImage && albumId !== undefined
            ? { album: { id: albumId, index: imageIndex, count } }
            : {}),
        });
        if (isImage) {
          imageIndex += 1;
        }
      });
      setStaged([]);
      setAttachDialogOpen(false);
    },
    [chatId, replyTo, staged, storeApi, value],
  );

  // Cancelling the send dialog drops the pick (the caption stays in the draft).
  const closeAttachDialog = useCallback((): void => {
    setStaged([]);
    setAttachDialogOpen(false);
  }, []);

  const reset = (): void => {
    setStaged([]);
    setAttachmentError(undefined);
    setStickerOpen(false);
    setAttachDialogOpen(false);
  };

  return {
    attachment,
    attachments: staged,
    previewUrls,
    setAttachment,
    removeAttachment,
    attachmentError,
    setAttachmentError,
    stickerOpen,
    setStickerOpen,
    attachDialogOpen,
    closeAttachDialog,
    stickerWrapRef,
    onPaste,
    acceptFiles,
    sendPending,
    sendSticker,
    sendGif,
    reset,
  };
}
