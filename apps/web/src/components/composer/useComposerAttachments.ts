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
import type { GifItem } from '@zilar/chat-core';
import type { StickerChoice } from '@zilar/chat-core';
import type { StoreApi } from '@zilar/client-core';
import type { ChatStoreState } from '@/store/store';
import { classify, objectUrlFor, type PendingAttachment } from '@/lib/attachments';
import { ComposerFailure, fork } from './composerShared';
import { MAX_ATTACHMENT_BYTES, gifBlobType } from '@zilar/chat-core';

const GIF_LOAD_FAILED = 'Could not load that GIF. Try another.';
/**
 * Telegram's cap, and the mobile picker's `selectionLimit`.
 */
const MAX_FILES = 10;
const FILE_EMPTY = 'That file is empty.';
const FILE_TOO_LARGE = 'That file is larger than 50 MB.';
const TOO_MANY_FILES = 'You can send up to 10 files at once.';

function refusal(file: File): string | undefined {
  if (file.size === 0) {
    return FILE_EMPTY;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return FILE_TOO_LARGE;
  }
  return undefined;
}

function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

export interface SendPendingOptions {
  asFiles?: boolean;
}

export interface ComposerAttachments {
  attachment: PendingAttachment | undefined;
  attachments: PendingAttachment[];
  previewUrls: (string | undefined)[];
  setAttachment: Dispatch<SetStateAction<PendingAttachment | undefined>>;
  removeAttachment: (index: number) => void;
  attachmentError: string | undefined;
  setAttachmentError: Dispatch<SetStateAction<string | undefined>>;
  stickerOpen: boolean;
  setStickerOpen: Dispatch<SetStateAction<boolean>>;
  attachDialogOpen: boolean;
  closeAttachDialog: () => void;
  stickerWrapRef: RefObject<HTMLSpanElement | null>;
  onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  acceptFiles: (files: readonly File[], options?: { media?: boolean }) => void;
  sendPending: (options?: SendPendingOptions) => void;
  sendSticker: (sticker: StickerChoice) => void;
  sendGif: (gif: GifItem) => void;
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
  const stickerWrapRef = useRef<HTMLSpanElement>(null);
  const attachment = staged[0];

  // Every picker, paste and drop funnels its files here. An empty or oversized
  // file is refused inline, before any request; a pick is capped at ten files in
  // pick order, each tagged by `classify`; a `media` pick opens the send dialog
  // only when every chosen file is media.
  const acceptFiles = useCallback((files: readonly File[], options?: { media?: boolean }): void => {
    setAttachmentError(undefined);
    const chosen = [...files];
    if (chosen.length === 0) {
      return;
    }
    for (const file of chosen) {
      const error = refusal(file);
      if (error !== undefined) {
        setAttachmentError(error);
        return;
      }
    }
    if (chosen.length > MAX_FILES) {
      setAttachmentError(TOO_MANY_FILES);
    }
    const isMedia = options?.media === true && chosen.every(isMediaFile);
    setStaged(chosen.slice(0, MAX_FILES).map((file) => ({ file, kind: classify(file) })));
    setAttachDialogOpen(isMedia);
  }, []);

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

  // The preview thumbnails' object URLs are revoked when replaced or the
  // composer unmounts, so they never leak.
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

  // The toggle button lives inside the wrapper, so clicking it to open never
  // counts as "outside" (it fires before the toggle's click).
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

  // A GIF is fetched through the proxy and stored as our attachment, so it
  // keeps working if the provider disappears. The mime and extension come from
  // the proxied blob's real content type, never from the search result's kind.
  const sendGif = useCallback(
    (gif: GifItem): void => {
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

  // Two or more photos share one album id with `index`; only the first message
  // carries the caption and reply, and uploads run in parallel, rendered by
  // `index`. "Send as files" drops the album marker so each photo stands alone.
  const sendPending = useCallback(
    (options?: SendPendingOptions): void => {
      const store = storeApi.getState();
      const caption = value.trim();
      const asFiles = options?.asFiles === true;
      const count = asFiles ? 0 : staged.filter((item) => item.kind === 'image').length;
      const albumId = count >= 2 ? crypto.randomUUID() : undefined;
      const ordered =
        albumId === undefined
          ? staged
          : [
              ...staged.filter((item) => item.kind === 'image'),
              ...staged.filter((item) => item.kind !== 'image'),
            ];
      let imageIndex = 0;
      ordered.forEach((item, index) => {
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
