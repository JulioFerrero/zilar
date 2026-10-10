/**
 * The mock-mode attachment uploader (T-1047): a no-network stand-in for the
 * real {@link AttachmentUploader}. In mock mode the fake XMPP core's upload
 * slot is a `data:` URL, so the native PUT fails; this reports progress on
 * short timers and resolves without touching the network. Cancelling one
 * message's upload makes it reject with `new Error('cancelled')`, the shape the
 * real uploader uses; other messages keep running.
 */

import { Effect } from 'effect';

import type { AttachmentUploader, PickedFile } from '../lib/attachment-ports';

// Short waits so the progress and the completion still read as an upload.
const HALF_DELAY_MS = 40;
const FULL_DELAY_MS = 80;

/**
 * Reports `0.5`, then `1`, each after a short wait; a cancel that lands during
 * a wait rejects the upload with the `cancelled` error.
 */
function uploadEffect(
  onProgress: ((fraction: number) => void) | undefined,
  pending: { cancelled: boolean },
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => onProgress?.(0.5));
    yield* Effect.sleep(HALF_DELAY_MS);
    if (pending.cancelled) {
      return yield* Effect.fail(new Error('cancelled'));
    }
    yield* Effect.sync(() => onProgress?.(1));
    yield* Effect.sleep(FULL_DELAY_MS);
    if (pending.cancelled) {
      return yield* Effect.fail(new Error('cancelled'));
    }
  });
}

/**
 * The mock uploader: no network at all. Each upload is keyed by message id (or
 * the file URI when there is none), so two chats uploading at once stay
 * independent and cancelling one never touches the other.
 */
export function createMockUploader(): AttachmentUploader {
  const pending = new Map<string, { cancelled: boolean }>();
  return {
    upload(
      file: PickedFile,
      _slot: { putUrl: string; headers: Record<string, string> },
      onProgress?: (fraction: number) => void,
      messageId?: string,
    ): Promise<void> {
      const key = messageId ?? file.uri;
      const current = { cancelled: false };
      pending.set(key, current);
      return Effect.runPromise(
        uploadEffect(onProgress, current).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (pending.get(key) === current) {
                pending.delete(key);
              }
            }),
          ),
        ),
      );
    },
    cancel(messageId: string): void {
      const current = pending.get(messageId);
      if (current !== undefined) {
        current.cancelled = true;
        pending.delete(messageId);
      }
    },
  };
}
