// Plain values, so the store and the composer inject fakes in tests.

import type { PendingMobileFile } from './attachments';

export interface PickedFile extends PendingMobileFile {
  uri: string;
  name: string;
  mimeType: string;
  /**
   * `undefined` means unknown, never empty: only a real zero is refused as empty.
   */
  size?: number | undefined;
}

/**
 * Only a proxy URL the panel showed is fetched; the real content type decides the mime and extension.
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

/**
 * A library pick may return several files; `file` stays the first one, so single-file callers keep working.
 */
export type PickResult =
  | { status: 'picked'; file: PickedFile; files: PickedFile[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface AttachmentPicker {
  pickImageOrVideo(): Promise<PickResult>;
  takePhoto(): Promise<PickResult>;
  pickFile(): Promise<PickResult>;
}

export interface AttachmentUploader {
  /**
   * Each call is independent; rejects with `cancelled` only when `cancel` aborts this upload.
   */
  upload(
    file: PickedFile,
    slot: { putUrl: string; headers: Record<string, string> },
    onProgress?: (fraction: number) => void,
    messageId?: string,
  ): Promise<void>;
  /**
   * Other messages' uploads keep running; this message's `upload` then rejects with `cancelled`.
   */
  cancel(messageId: string): void;
}

export interface AttachmentOpener {
  open(
    url: string,
    name: string,
  ): Promise<{ status: 'opened' } | { status: 'error'; message: string }>;
}
