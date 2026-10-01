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
  size: number;
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

/** Uploads one picked file with progress; cancellable and re-runnable. */
export interface AttachmentUploader {
  /** PUTs the bytes to the slot URL with the slot's headers. */
  upload(
    file: PickedFile,
    slot: { putUrl: string; headers: Record<string, string> },
    onProgress?: (fraction: number) => void,
  ): Promise<void>;
  /** Cancels the in-flight upload, if any. Afterwards `upload` rejects. */
  cancel(): void;
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
