import { Effect } from 'effect';
import { useRef, useState, type RefObject } from 'react';
import type { StickerPack } from '@/lib/api';
import { useAction } from '@/lib/effect/use-action';
import {
  CallFailed,
  call,
  messageOf,
  type PackEditorItem,
  type PackEditorProps,
} from './packEditorModel';
import { failureOf, isWaiting } from '@zilar/client-core';

interface SaveInput {
  readonly title: string;
  readonly visibility: 'private' | 'server';
  readonly items: ReadonlyArray<PackEditorItem>;
}

export interface UsePackSaveOptions {
  packId: string | undefined;
  initialTitle: string;
  initialVisibility: 'private' | 'server';
  title: string;
  visibility: 'private' | 'server';
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

export interface PackSaveControls {
  save: () => void;
  busy: boolean;
  shownFormError: string;
  progress: string | undefined;
}

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
  // Create mode keeps the pack minted on the first save, so a retry after a
  // partial upload resumes into it instead of minting a second one; a title or
  // visibility change since creation is patched onto it, not silently dropped.
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

  const editStep = (pack: string, input: SaveInput): Effect.Effect<string, CallFailed> =>
    Effect.gen(function* () {
      if (input.title !== initialTitle || input.visibility !== initialVisibility) {
        yield* call(() => patchPack(pack, { title: input.title, visibility: input.visibility }));
      }
      yield* flushRemovals(pack);
      return pack;
    });

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
      // Edit mode keeps the server order matching the UI: removals, uploads and
      // moves land in one order patch computed from the finished list (`itemsRef`),
      // never the click-time snapshot.
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
      if (failed === 0) {
        yield* Effect.sync(() => onDone(finalId));
      }
    });

  const [saveState, runSave] = useAction((input: SaveInput) => saveEffect(input));
  const busy = isWaiting(saveState);
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
