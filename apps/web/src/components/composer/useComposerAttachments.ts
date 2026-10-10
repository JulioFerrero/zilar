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

export interface ComposerAttachments {
  attachment: PendingAttachment | undefined;
  setAttachment: Dispatch<SetStateAction<PendingAttachment | undefined>>;
  attachmentError: string | undefined;
  setAttachmentError: Dispatch<SetStateAction<string | undefined>>;
  stickerOpen: boolean;
  setStickerOpen: Dispatch<SetStateAction<boolean>>;
  attachmentPreviewUrl: string | undefined;
  fileInputRef: RefObject<HTMLInputElement | null>;
  stickerWrapRef: RefObject<HTMLSpanElement | null>;
  onPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  acceptFile: (file: File) => void;
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
  const [attachment, setAttachment] = useState<PendingAttachment | undefined>(undefined);
  const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);
  const [stickerOpen, setStickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The sticker toggle button plus the panel: a pointer-down outside this
  // wrapper closes the panel (the panel itself is viewport-fixed, so the
  // Composer subtree cannot contain it).
  const stickerWrapRef = useRef<HTMLSpanElement>(null);

  // The picker, paste and drop all funnel a chosen file through here. An empty
  // or oversized file is refused inline, before any request.
  const acceptFile = useCallback((file: File): void => {
    setAttachmentError(undefined);
    if (file.size === 0) {
      setAttachmentError('That file is empty.');
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachmentError('That file is larger than 50 MB.');
      return;
    }
    setAttachment({ file, kind: classify(file) });
  }, []);

  const attachmentPreviewUrl = useMemo(
    () =>
      attachment !== undefined && attachment.kind === 'image'
        ? objectUrlFor(attachment.file)
        : undefined,
    [attachment],
  );

  // The preview thumbnail's object URL is revoked when it is replaced or the
  // composer unmounts, so it never leaks.
  useEffect(
    () => () => {
      if (attachmentPreviewUrl !== undefined) {
        URL.revokeObjectURL(attachmentPreviewUrl);
      }
    },
    [attachmentPreviewUrl],
  );

  // A file dropped anywhere on the chat panel (or the page) opens the preview,
  // exactly like the picker.
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') === true) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent): void => {
      const file = event.dataTransfer?.files[0];
      if (file === undefined) {
        return;
      }
      event.preventDefault();
      acceptFile(file);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [acceptFile]);

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    const transfer = event.clipboardData;
    if (transfer === undefined) {
      return;
    }
    let file = transfer.files[0];
    if (file === undefined) {
      for (let index = 0; index < transfer.items.length; index += 1) {
        const item = transfer.items[index];
        if (item !== undefined && item.kind === 'file') {
          const fromItem = item.getAsFile();
          if (fromItem !== null) {
            file = fromItem;
            break;
          }
        }
      }
    }
    if (file !== undefined) {
      event.preventDefault();
      acceptFile(file);
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

  const reset = (): void => {
    setAttachment(undefined);
    setAttachmentError(undefined);
    setStickerOpen(false);
  };

  return {
    attachment,
    setAttachment,
    attachmentError,
    setAttachmentError,
    stickerOpen,
    setStickerOpen,
    attachmentPreviewUrl,
    fileInputRef,
    stickerWrapRef,
    onPaste,
    acceptFile,
    sendSticker,
    sendGif,
    reset,
  };
}
