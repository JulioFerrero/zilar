import { Data, Effect } from 'effect';
import { type ChatBackgroundPresetId } from '@zilar/ui-tokens';

export type Scope = 'chat' | 'all';

/** T-0464: the dim slider saves this long after the last change. */
export const DIM_SAVE_DELAY_MS = 400;

/** The chat store rejected a write; the dialog shows its fixed sentence. */
export class SaveFailed extends Data.TaggedError('SaveFailed') {}

/** A picked image could not be prepared or uploaded; `text` is the fixed sentence. */
export class UploadFailed extends Data.TaggedError('UploadFailed')<{ readonly text: string }> {}

/** The image could not be deleted. */
export class DeleteFailed extends Data.TaggedError('DeleteFailed') {}

/** One save: an optional wait (the dim slider), then one store write. */
export interface SaveRequest {
  readonly delayMs: number;
  readonly write: () => Promise<void>;
}

export interface UploadRequest {
  readonly file: File;
  readonly scope: Scope;
}

/** A store write as an Effect: a rejection becomes SaveFailed. */
export const writeSave = (write: () => Promise<void>): Effect.Effect<void, SaveFailed> =>
  Effect.tryPromise({ try: write, catch: () => new SaveFailed() });

export function presetLabel(id: ChatBackgroundPresetId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** A plain sentence for an upload failure, never the server's text. */
export function uploadErrorMessage(error: unknown): string {
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
