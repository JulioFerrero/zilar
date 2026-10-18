import { Data, Effect, type Effect as EffectType } from 'effect';
import { StickersApiError } from '../../lib/stickers-api';

/**
 * Pure helpers for the sticker pack editor, kept dependency-free so the screen
 * tests never touch native modules.
 */

export const MAX_PACK_STICKERS = 120;

export interface EditorNewItem {
  key: string;
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  emoji: string;
  status: 'ready' | 'uploading' | 'uploaded' | 'failed-prepare' | 'uploadFailed';
  error?: string | undefined;
  stickerId?: string | undefined;
}

let editorKey = 0;

export function nextEditorKey(): string {
  editorKey += 1;
  return `new-sticker-${editorKey}`;
}

export function editorStickerCount(savedVisible: number, fresh: readonly EditorNewItem[]): number {
  return savedVisible + fresh.length;
}

export function takeFittingImages<T>(
  images: readonly T[],
  slotsLeft: number,
): {
  taken: T[];
  skipped: boolean;
} {
  if (slotsLeft <= 0) {
    return { taken: [], skipped: images.length > 0 };
  }
  return {
    taken: images.slice(0, slotsLeft),
    skipped: images.length > slotsLeft,
  };
}

/**
 * Maps an upload error to the row's fixed sentence. A pack-full code during an
 * upload is a row error, not the form error.
 */
export function rowErrorFor(error: unknown): string {
  if (error instanceof StickersApiError) {
    switch (error.code) {
      case 'sticker_too_large':
        return 'This image is too big. A sticker can be up to 512 KB and 512 px.';
      case 'sticker_empty':
        return 'This image is empty.';
      case 'sticker_not_image':
        return 'This file type is not supported. Use PNG, JPEG, WebP or GIF.';
      case 'pack_full':
        return 'This pack is full. A pack holds up to 120 stickers.';
      default:
        return 'The upload failed. Try again.';
    }
  }
  return 'The upload failed. Try again.';
}

/**
 * Maps a save error to the form's fixed sentence. Row codes are never form
 * errors: the failed rows show their own sentences instead.
 */
export function formErrorFor(error: unknown): string {
  if (error instanceof StickersApiError) {
    switch (error.code) {
      case 'pack_limit':
        return 'You have reached the limit of 100 packs.';
      case 'imported_private':
        return 'Imported packs are for personal use and cannot be shared.';
      case 'pack_full':
        return 'This pack is full. A pack holds up to 120 stickers.';
      default:
        return 'Could not save the pack. Try again.';
    }
  }
  return 'Could not save the pack. Try again.';
}

/**
 * Whether the pack lookup failed because the pack is gone or not the caller's
 * own: those show the fixed sentences instead of the load error.
 */
export function lookupFailureKind(error: unknown): 'not-found' | 'forbidden' | 'other' {
  if (error instanceof StickersApiError) {
    if (error.status === 404 || error.code === 'not_found') {
      return 'not-found';
    }
    if (error.status === 403 || error.code === 'forbidden') {
      return 'forbidden';
    }
  }
  return 'other';
}

export interface SavePendingItem {
  key: string;
  uri: string;
  mimeType: string;
  emoji: string;
}

export type SaveRowStatus = 'uploading' | 'uploaded' | 'uploadFailed';

export interface SavePackApi {
  createStickerPack(input: {
    title: string;
    visibility?: 'private' | 'server';
  }): Promise<{ id: string }>;
  patchStickerPack(
    packId: string,
    input: { title?: string; visibility?: 'private' | 'server'; order?: string[] },
  ): Promise<unknown>;
  deletePackSticker(packId: string, stickerId: string): Promise<void>;
  uploadStickerFile(
    packId: string,
    file: { uri: string; mimeType: string },
    emoji?: string,
  ): Promise<{ id: string }>;
}

export interface SavePackInput {
  api: SavePackApi;
  target:
    | {
        kind: 'create';
        createdPackId?: string | undefined;
        createdTitle?: string | undefined;
        createdVisibility?: 'private' | 'server' | undefined;
      }
    | { kind: 'edit'; packId: string };
  title: string;
  visibility: 'private' | 'server';
  initialTitle: string;
  initialVisibility: 'private' | 'server';
  removedIds: string[];
  pending: SavePendingItem[];
  onRow(key: string, status: SaveRowStatus, error?: string): void;
  onProgress(done: number, total: number): void;
  onRemovedFlushed(): void;
  onCreated?(created: { id: string; title: string; visibility: 'private' | 'server' }): void;
}

export type SavePackOutcome =
  | {
      ok: true;
      packId: string;
      created?: { id: string; title: string; visibility: 'private' | 'server' } | undefined;
    }
  | {
      ok: false;
      partial: true;
      created?: { id: string; title: string; visibility: 'private' | 'server' } | undefined;
    }
  | { ok: false; partial: false; formError: string };

export interface DeletePackApi {
  deleteStickerPack(packId: string): Promise<{ warning: string }>;
}

class SaveStepFailed extends Data.TaggedError('SaveStepFailed')<{ readonly error: unknown }> {}

const attempt = <A>(run: () => A): EffectType.Effect<A, SaveStepFailed> =>
  Effect.try({ try: run, catch: (error) => new SaveStepFailed({ error }) });

const attemptPromise = <A>(run: () => PromiseLike<A>): EffectType.Effect<A, SaveStepFailed> =>
  Effect.tryPromise({ try: run, catch: (error) => new SaveStepFailed({ error }) });

const deletePackEffect = (api: DeletePackApi, packId: string): EffectType.Effect<boolean> =>
  attemptPromise(() => api.deleteStickerPack(packId)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

/**
 * Deletes the pack for the delete modal. Returns whether the pack is gone; the
 * screen closes the modal and goes back on success, or keeps it open on failure.
 */
export function runDeletePack(api: DeletePackApi, packId: string): Promise<boolean> {
  return Effect.runPromise(deletePackEffect(api, packId));
}

type CreatedPack = { id: string; title: string; visibility: 'private' | 'server' };

const mintPack = (
  input: SavePackInput,
  title: string,
): EffectType.Effect<CreatedPack, SaveStepFailed> =>
  attemptPromise(() => input.api.createStickerPack({ title, visibility: input.visibility })).pipe(
    Effect.map((pack): CreatedPack => ({ id: pack.id, title, visibility: input.visibility })),
    Effect.tap((created) => attempt(() => input.onCreated?.(created))),
  );

/**
 * Edit mode, or a create-mode retry: patch the title/visibility when they
 * changed, delete the removed stickers, then flush the removed list.
 */
const saveExistingPack = Effect.fnUntraced(function* (
  input: SavePackInput,
  trimmed: string,
): EffectType.fn.Return<string, SaveStepFailed> {
  const targetId =
    input.target.kind === 'create' ? (input.target.createdPackId as string) : input.target.packId;
  const baselineTitle =
    input.target.kind === 'create' ? (input.target.createdTitle ?? '') : input.initialTitle;
  const baselineVisibility =
    input.target.kind === 'create'
      ? (input.target.createdVisibility ?? 'private')
      : input.initialVisibility;
  if (trimmed !== baselineTitle || input.visibility !== baselineVisibility) {
    yield* attemptPromise(() =>
      input.api.patchStickerPack(targetId, { title: trimmed, visibility: input.visibility }),
    );
  }
  for (const stickerId of input.removedIds) {
    // A 404 means the sticker is already gone (a previous partial save deleted
    // it before an upload failed), so a retry must not stick on the ghost id. Any
    // other delete error still fails the save and the delete is retried next time.
    yield* attemptPromise(() => input.api.deletePackSticker(targetId, stickerId)).pipe(
      Effect.catch((failure) =>
        lookupFailureKind(failure.error) === 'not-found' ? Effect.void : Effect.fail(failure),
      ),
    );
  }
  yield* attempt(() => input.onRemovedFlushed());
  return targetId;
});

/**
 * The Save loop both modes share (web order): create the pack first in create
 * mode (once — a retry reuses the minted id), patch title/visibility, then
 * deletions, then uploads one by one. Only a pack or patch failure is a form error.
 */
const savePackSteps = Effect.fnUntraced(function* (
  input: SavePackInput,
): EffectType.fn.Return<SavePackOutcome, SaveStepFailed> {
  const trimmed = input.title.trim();
  const created =
    input.target.kind === 'create' && input.target.createdPackId === undefined
      ? yield* mintPack(input, trimmed)
      : undefined;
  const targetId = created !== undefined ? created.id : yield* saveExistingPack(input, trimmed);
  let done = 0;
  let failed = 0;
  for (const item of input.pending) {
    yield* attempt(() => input.onRow(item.key, 'uploading'));
    yield* attemptPromise(() =>
      input.api.uploadStickerFile(
        targetId,
        { uri: item.uri, mimeType: item.mimeType },
        item.emoji === '' ? undefined : item.emoji,
      ),
    ).pipe(
      Effect.flatMap((uploaded) =>
        attempt(() => {
          done += 1;
          input.onProgress(done, input.pending.length);
          input.onRow(item.key, 'uploaded', uploaded.id);
        }),
      ),
      Effect.catch((failure) => {
        failed += 1;
        return attempt(() => input.onRow(item.key, 'uploadFailed', rowErrorFor(failure.error)));
      }),
    );
  }
  if (failed > 0) {
    // A partial upload failure leaves the editor open with per-row Retry: not a
    // form error. The created id travels back so the screen keeps it for the retry.
    return { ok: false, partial: true, ...(created === undefined ? {} : { created }) };
  }
  return { ok: true, packId: targetId, ...(created === undefined ? {} : { created }) };
});

export function runSavePack(input: SavePackInput): Promise<SavePackOutcome> {
  return Effect.runPromise(
    savePackSteps(input).pipe(
      Effect.catch((failure) =>
        Effect.succeed<SavePackOutcome>({
          ok: false,
          partial: false,
          formError: formErrorFor(failure.error),
        }),
      ),
    ),
  );
}
