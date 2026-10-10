import { Effect } from 'effect';
import { useRef, useState, type RefObject } from 'react';
import type { StickerPack } from '@/lib/api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import {
  CallFailed,
  call,
  messageOf,
  type PackEditorItem,
  type PackEditorProps,
} from './packEditorModel';

/** What Save sends: the click-time values, so the save never reads a half-edited form. */
interface SaveInput {
  readonly title: string;
  readonly visibility: 'private' | 'server';
  readonly items: ReadonlyArray<PackEditorItem>;
}

export interface UsePackSaveOptions {
  packId: string | undefined;
  initialTitle: string;
  initialVisibility: 'private' | 'server';
  /** The click-time title and visibility the editor holds. */
  title: string;
  visibility: 'private' | 'server';
  /** The click-time rows; `itemsRef` is the finished list at order-PATCH time. */
  items: PackEditorItem[];
  itemsRef: RefObject<PackEditorItem[]>;
  initialIdsRef: RefObject<string[]>;
  removedIdsRef: RefObject<string[]>;
  updateRow: (key: string, patch: Partial<PackEditorItem>) => void;
  onDone: (packId: string) => void;
  createPack: NonNullable<PackEditorProps['createPack']>;
  uploadFile: NonNullable<PackEditorProps['uploadFile']>;
  patchPack: NonNullable<PackEditorProps['patchPack']>;
  deleteSticker: NonNullable<PackEditorProps['deleteSticker']>;
}

/** The state and the one action the editor's form and buttons read. */
export interface PackSaveControls {
  save: () => void;
  busy: boolean;
  shownFormError: string;
  progress: string | undefined;
}

/**
 * The pack save: the removals, the create/edit/resume steps, the sequential
 * uploads with per-file retry, the order patch and the validation before a
 * save starts. It owns the form error, the upload progress counts and the
 * create-mode refs the component used to hold.
 */
export function usePackSave({
  packId,
  initialTitle,
  initialVisibility,
  title,
  visibility,
  items,
  itemsRef,
  initialIdsRef,
  removedIdsRef,
  updateRow,
  onDone,
  createPack,
  uploadFile,
  patchPack,
  deleteSticker,
}: UsePackSaveOptions): PackSaveControls {
  const [formError, setFormError] = useState('');
  const [doneCount, setDoneCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  // Create mode: the pack minted on the first save, plus the title and
  // visibility it was created with. Kept across Save clicks so a retry
  // after a partial upload resumes into the same pack instead of minting a
  // second one — and a title/visibility change since the creation is
  // patched onto it rather than silently dropped.
  const createdPackIdRef = useRef<string | undefined>(undefined);
  const createdTitleRef = useRef<string | undefined>(undefined);
  const createdVisibilityRef = useRef<'private' | 'server' | undefined>(undefined);

  // Each landed delete leaves the queue at once, so a retry after a later
  // failure does not 404 on an already-deleted sticker.
  const flushRemovals = (pack: string): Effect.Effect<void, CallFailed> => {
    const removedIds = removedIdsRef.current;
    removedIdsRef.current = [];
    return Effect.forEach(
      removedIds,
      (stickerId) =>
        call(() => deleteSticker(pack, stickerId)).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              removedIdsRef.current = [
                ...removedIds.slice(removedIds.indexOf(stickerId)),
                ...removedIdsRef.current,
              ];
            }),
          ),
        ),
      { discard: true },
    );
  };

  // Create mode mints the pack on the first save and remembers it, so a
  // retry resumes into the same pack.
  const createStep = (input: SaveInput): Effect.Effect<string, CallFailed> =>
    Effect.gen(function* () {
      const created: StickerPack = yield* call(() =>
        createPack({ title: input.title, visibility: input.visibility }),
      );
      createdPackIdRef.current = created.id;
      createdTitleRef.current = input.title;
      createdVisibilityRef.current = input.visibility;
      return created.id;
    });

  // Edit mode: title/visibility patch first, then the sticker diff.
  const editStep = (pack: string, input: SaveInput): Effect.Effect<string, CallFailed> =>
    Effect.gen(function* () {
      if (input.title !== initialTitle || input.visibility !== initialVisibility) {
        yield* call(() => patchPack(pack, { title: input.title, visibility: input.visibility }));
      }
      yield* flushRemovals(pack);
      return pack;
    });

  // Create-mode resume: the pack already exists from the first save, so a
  // title/visibility change since the creation is patched onto it instead of
  // silently dropped — and stickers uploaded then removed in-session are
  // deleted, not orphaned.
  const resumeStep = (pack: string, input: SaveInput): Effect.Effect<string, CallFailed> =>
    Effect.gen(function* () {
      if (
        input.title !== createdTitleRef.current ||
        input.visibility !== createdVisibilityRef.current
      ) {
        yield* call(() => patchPack(pack, { title: input.title, visibility: input.visibility }));
        createdTitleRef.current = input.title;
        createdVisibilityRef.current = input.visibility;
      }
      yield* flushRemovals(pack);
      return pack;
    });

  const packStep = (input: SaveInput): Effect.Effect<string, CallFailed> => {
    const known = packId ?? createdPackIdRef.current;
    if (known === undefined) {
      return createStep(input);
    }
    return packId !== undefined ? editStep(known, input) : resumeStep(known, input);
  };

  // The whole save: the pack, the removals, the uploads (one at a time, so
  // the progress count is exact; a failed file becomes its row's error and
  // the rest go on) and the order patch.
  const saveEffect = (input: SaveInput): Effect.Effect<void, CallFailed> =>
    Effect.gen(function* () {
      const finalId = yield* packStep(input);
      let done = 0;
      const uploadedIds = new Map<string, string>();
      const ordered = input.items.filter(
        (item) => item.status !== 'done' && item.error === undefined,
      );
      const uploads = ordered.flatMap((item) =>
        item.blob === undefined ? [] : [{ item, blob: item.blob }],
      );
      const landed = yield* Effect.forEach(uploads, ({ item, blob }) =>
        Effect.sync(() => updateRow(item.key, { status: 'uploading', error: undefined })).pipe(
          Effect.andThen(
            call(() => uploadFile(finalId, blob, item.emoji === '' ? undefined : item.emoji)),
          ),
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.sync(() => {
                updateRow(item.key, {
                  status: 'error',
                  error: messageOf(failure, 'The upload failed. Try again.'),
                });
                return false;
              }),
            onSuccess: (uploaded) =>
              Effect.sync(() => {
                done += 1;
                setDoneCount(done);
                uploadedIds.set(item.key, uploaded.id);
                updateRow(item.key, { status: 'done', stickerId: uploaded.id });
                return true;
              }),
          }),
        ),
      );
      const failed = landed.filter((ok) => !ok).length;
      // Edit mode keeps the server order matching the UI: removals,
      // uploads and moves all land in one order patch, computed from the
      // finished list (itemsRef), never the click-time snapshot.
      if (packId !== undefined && failed === 0) {
        const removed = new Set(removedIdsRef.current);
        const currentIds: string[] = [];
        for (const item of itemsRef.current) {
          const id = uploadedIds.get(item.key) ?? item.stickerId;
          if (id !== undefined && !removed.has(id)) {
            currentIds.push(id);
          }
        }
        const initialIds = initialIdsRef.current.filter((id) => !removed.has(id));
        const orderChanged =
          removedIdsRef.current.length > 0 ||
          uploadedIds.size > 0 ||
          currentIds.length !== initialIds.length ||
          currentIds.some((id, index) => id !== initialIds[index]);
        if (orderChanged) {
          yield* call(() => patchPack(finalId, { order: currentIds }));
        }
      }
      // Only finish when every sticker landed: a partial failure leaves
      // the editor open (with per-file Retry) instead of closing over it.
      if (failed === 0) {
        yield* Effect.sync(() => onDone(finalId));
      }
    });

  const [saveState, runSave] = useAction((input: SaveInput) => saveEffect(input));
  const busy = isWaiting(saveState);
  // A save that failed outright (not one file) shows here until the next save.
  const saveFailure = busy ? undefined : failureOf(saveState);
  const saveFailureText =
    saveFailure !== undefined ? messageOf(saveFailure, 'Could not save the pack.') : '';
  const shownFormError = formError !== '' ? formError : saveFailureText;

  const save = (): void => {
    const trimmed = title.trim();
    if (trimmed === '') {
      setFormError('Name the pack first.');
      return;
    }
    if (items.some((item) => item.error !== undefined)) {
      setFormError('Retry or remove the failed stickers first.');
      return;
    }
    const pending = items.filter((item) => item.status !== 'done' && item.error === undefined);
    if (packId === undefined && pending.length === 0) {
      setFormError('Add at least one sticker first.');
      return;
    }
    setFormError('');
    setDoneCount(0);
    setActiveCount(pending.length);
    runSave({ title: trimmed, visibility, items });
  };

  const progress =
    busy && activeCount > 0 ? `Uploading ${doneCount} of ${activeCount}…` : undefined;

  return { save, busy, shownFormError, progress };
}
