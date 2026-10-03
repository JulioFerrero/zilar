/**
 * The native seams for attachments (T-0150): picking, uploading and opening
 * files. The shapes are plain values so the store and the composer can inject
 * fakes in tests; the real implementations below are the only place that
 * touches the Expo native modules.
 */

import type { PendingMobileFile } from './attachments';

/** One file the user picked, ready to upload. */
export interface PickedFile extends PendingMobileFile {
  uri: string;
  name: string;
  mimeType: string;
  /**
   * Byte size when known. `undefined` means unknown: the picker reported no
   * size and the stat failed (or was never attempted). Only a real zero says
   * "That file is empty" (T-0157); an unknown size is never refused as empty.
   */
  size?: number | undefined;
}

/**
 * Downloads one GIF-tab result through the same-origin proxy into the cache
 * dir and reports it as a picked file, so the send travels the normal
 * attachment upload path. The URL must be a proxy URL the panel showed (the
 * composer passes the picked item); anything else is refused without a
 * fetch. The real content type decides the mime and extension (validated
 * against the four types the proxy serves), exactly like web's `sendGif`.
 */
export interface GifDownloader {
  download(gif: {
    id: string;
    url: string;
    kind: 'image' | 'video';
    width: number;
    height: number;
  }): Promise<{ status: 'downloaded'; file: PickedFile } | { status: 'error'; message: string }>;
}

/** Result of one pick attempt: a file, a cancel, or a user-facing error. */
export type PickResult =
  | { status: 'picked'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/** Opens the OS pickers (library, camera, file). Tests inject a fake. */
export interface AttachmentPicker {
  pickImageOrVideo(): Promise<PickResult>;
  takePhoto(): Promise<PickResult>;
  pickFile(): Promise<PickResult>;
}

/** Uploads one picked file with progress; cancellable per message. */
export interface AttachmentUploader {
  /**
   * PUTs the bytes to the slot URL with the slot's headers. Each call is
   * independent: starting one upload never aborts another. Rejects with a
   * `cancelled` error only when `cancel` aborts this very upload.
   */
  upload(
    file: PickedFile,
    slot: { putUrl: string; headers: Record<string, string> },
    onProgress?: (fraction: number) => void,
    messageId?: string,
  ): Promise<void>;
  /**
   * Cancels one message's in-flight upload, if any. Other messages'
   * uploads keep running. Afterwards that message's `upload` rejects with
   * a `cancelled` error.
   */
  cancel(messageId: string): void;
}

/**
 * Opens a downloaded/opened file with the system UI. Tests inject a fake;
 * the real implementation downloads to the cache dir and shares it.
 */
export interface AttachmentOpener {
  open(
    url: string,
    name: string,
  ): Promise<{ status: 'opened' } | { status: 'error'; message: string }>;
}
