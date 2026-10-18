import { Data, Effect } from 'effect';
import { type ChatBackgroundPresetId } from '@zilar/ui-tokens';

export type Scope = 'chat' | 'all';

export const DIM_SAVE_DELAY_MS = 400;

export class SaveFailed extends Data.TaggedError('SaveFailed') {}

export class UploadFailed extends Data.TaggedError('UploadFailed')<{ readonly text: string }> {}

export class DeleteFailed extends Data.TaggedError('DeleteFailed') {}

export interface SaveRequest {
  readonly delayMs: number;
  readonly write: () => Promise<void>;
}

export interface UploadRequest {
  readonly file: File;
  readonly scope: Scope;
}

export const writeSave = (write: () => Promise<void>): Effect.Effect<void, SaveFailed> =>
  Effect.tryPromise({ try: write, catch: () => new SaveFailed() });

export function presetLabel(id: ChatBackgroundPresetId): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

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
