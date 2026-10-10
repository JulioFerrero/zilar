/**
 * The real native uploader seam (T-1021, split from `attachment-native.ts`):
 * a binary-content PUT of the local file through `expo-file-system`.
 */

import { Effect } from 'effect';
import { File, UploadType } from 'expo-file-system';

import type { AttachmentUploader, PickedFile } from './attachment-ports';

/** Fails with the server's `upload refused` text unless the status is 2xx. */
const checkUploadStatus = (result: { readonly status: number }): Effect.Effect<void, Error> =>
  result.status < 200 || result.status >= 300
    ? Effect.fail(new Error(`upload refused: ${result.status}`))
    : Effect.void;

/** One binary PUT of the local file, aborted through `current`. */
const uploadEffect = (
  file: PickedFile,
  slot: { putUrl: string; headers: Record<string, string> },
  onProgress: ((fraction: number) => void) | undefined,
  current: AbortController,
): Effect.Effect<void, unknown> =>
  Effect.tryPromise({
    try: () =>
      new File(file.uri).upload(slot.putUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { 'content-type': file.mimeType, ...slot.headers },
        mimeType: file.mimeType,
        onProgress:
          onProgress === undefined
            ? undefined
            : (data) => {
                if (data.totalBytes > 0) {
                  onProgress(Math.min(1, Math.max(0, data.bytesSent / data.totalBytes)));
                }
              },
        signal: current.signal,
      }),
    catch: (error: unknown) => error,
  }).pipe(
    Effect.flatMap(checkUploadStatus),
    // A failure after `cancel` reads as cancelled, whatever the native error was.
    Effect.mapError((error: unknown) => (current.signal.aborted ? new Error('cancelled') : error)),
  );

/**
 * The real uploader: a binary-content PUT of the local file to the slot URL
 * with the slot's headers. Each upload gets its own AbortController, keyed
 * by message id, so two chats uploading at once stay independent and
 * cancelling one never touches the other.
 */
export function createAttachmentUploader(): AttachmentUploader {
  const controllers = new Map<string, AbortController>();
  return {
    upload(
      file: PickedFile,
      slot: { putUrl: string; headers: Record<string, string> },
      onProgress?: (fraction: number) => void,
      messageId?: string,
    ): Promise<void> {
      const current = new AbortController();
      const key = messageId ?? file.uri;
      controllers.set(key, current);
      return Effect.runPromise(
        uploadEffect(file, slot, onProgress, current).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (controllers.get(key) === current) {
                controllers.delete(key);
              }
            }),
          ),
        ),
      );
    },
    cancel(messageId: string): void {
      controllers.get(messageId)?.abort();
      controllers.delete(messageId);
    },
  };
}
