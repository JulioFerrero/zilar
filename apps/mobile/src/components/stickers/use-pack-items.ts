import { Effect } from 'effect';
import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

import type { StickerItem } from '@/lib/stickers';
import type { StickersApi } from '@/lib/stickers-api';
import {
  MAX_PACK_STICKERS,
  editorStickerCount,
  nextEditorKey,
  runSavePack,
  takeFittingImages,
  type EditorNewItem,
} from '@/components/stickers/pack-editor';
import type {
  PickedStickerImage,
  StickerImagePicker,
  StickerImagePreparer,
} from '@/components/stickers/sticker-native';

export type PackVisibility = 'private' | 'server';

export interface UsePackItemsDeps {
  picker: StickerImagePicker;
  preparer: StickerImagePreparer;
  api: StickersApi;
  packId: string | undefined;
  title: string;
  visibility: PackVisibility;
  initialTitle: string;
  initialVisibility: PackVisibility;
  /** Guards a second pick or save while one runs (shared with the editor's delete). */
  busyRef: MutableRefObject<boolean>;
  /** Closes the screen after a successful save (`router.back`). */
  onSaved: () => void;
}

export interface PackItems {
  saved: StickerItem[];
  setSaved: Dispatch<SetStateAction<StickerItem[]>>;
  removedIds: string[];
  fresh: EditorNewItem[];
  preparing: number;
  skippedNote: boolean;
  count: number;
  packFull: boolean;
  hasFailedRows: boolean;
  readyCount: number;
  visibleSaved: StickerItem[];
  saving: boolean;
  progress: { done: number; total: number } | undefined;
  formError: string;
  /** Set after a partial create save: the screen stays on the minted pack. */
  createdPackId: string | undefined;
  pickImages: () => void;
  retryItem: (key: string) => void;
  removeFresh: (key: string) => void;
  removeSaved: (stickerId: string) => void;
  changeEmoji: (key: string, value: string) => void;
  save: () => void;
}

/**
 * The sticker items of the pack editor: the saved stickers, the removal
 * queue and the fresh picked rows, plus the pick/retry/remove handlers, the
 * session token and the Save/upload loop that runs over them. Split out of
 * `use-pack-editor.ts` to keep both hooks under 400 lines.
 */
export function usePackItems({
  picker,
  preparer,
  api,
  packId,
  title,
  visibility,
  initialTitle,
  initialVisibility,
  busyRef,
  onSaved,
}: UsePackItemsDeps): PackItems {
  const [saved, setSaved] = useState<StickerItem[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [fresh, setFresh] = useState<EditorNewItem[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [skippedNote, setSkippedNote] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined);
  // Create mode: the pack minted on the first save. Kept across Save clicks
  // so a retry after a partial upload resumes into the same pack instead of
  // minting a second one (web's `createdPackIdRef`).
  const createdPackIdRef = useRef<string | undefined>(undefined);
  const createdTitleRef = useRef<string | undefined>(undefined);
  const createdVisibilityRef = useRef<PackVisibility | undefined>(undefined);
  // Brief §5: after a partial create save the screen stays open on the
  // minted pack and the button reads `Save`. Kept as state (not derived
  // from the ref during render) so the lint `react(refs)` rule holds and
  // the re-render after save flips the label.
  const [createdPackId, setCreatedPackId] = useState<string | undefined>(undefined);

  const visibleSaved = saved.filter((sticker) => !removedIds.includes(sticker.id));
  const count = editorStickerCount(visibleSaved.length, fresh);

  const pickImages = useCallback(() => {
    if (busyRef.current || saving) {
      return;
    }
    const slotsLeft = MAX_PACK_STICKERS - count;
    if (slotsLeft <= 0) {
      return;
    }
    setFormError('');
    const take = slotsLeft;
    // One image at a time, in order.
    const prepareEach = (picked: readonly PickedStickerImage[]): Effect.Effect<void> =>
      Effect.forEach(
        picked,
        (image) =>
          Effect.promise(() => preparer.prepare(image)).pipe(
            Effect.tap((prepared) =>
              Effect.sync(() => {
                if (prepared.status === 'prepared') {
                  const row: EditorNewItem = {
                    key: nextEditorKey(),
                    uri: prepared.image.uri,
                    mimeType: prepared.image.mimeType,
                    width: prepared.image.width,
                    height: prepared.image.height,
                    bytes: prepared.image.bytes,
                    emoji: '',
                    status: 'ready',
                  };
                  setFresh((previous) => [...previous, row]);
                } else {
                  const row: EditorNewItem = {
                    key: nextEditorKey(),
                    uri: image.uri,
                    mimeType: 'image/png',
                    width: 0,
                    height: 0,
                    bytes: 0,
                    emoji: '',
                    status: 'failed-prepare',
                    error: prepared.message,
                  };
                  setFresh((previous) => [...previous, row]);
                }
                setPreparing((active) => active - 1);
              }),
            ),
          ),
        { discard: true },
      );
    Effect.runFork(
      Effect.promise(() => picker.pickImages()).pipe(
        Effect.flatMap((result) =>
          Effect.sync(() => {
            if (result.status === 'error') {
              setFormError(result.message);
              return [];
            }
            if (result.status !== 'picked') {
              return [];
            }
            const { taken, skipped } = takeFittingImages(result.images, take);
            if (skipped) {
              setSkippedNote(true);
            }
            if (taken.length > 0) {
              setPreparing((active) => active + taken.length);
            }
            return taken;
          }),
        ),
        Effect.flatMap((picked) => prepareEach(picked)),
      ),
    );
  }, [busyRef, count, picker, preparer, saving, setFormError]);

  const retryItem = useCallback(
    (key: string) => {
      setFormError('');
      setFresh((previous) =>
        previous.map((item) =>
          item.key === key ? { ...item, status: 'ready' as const, error: undefined } : item,
        ),
      );
    },
    [setFormError, setFresh],
  );

  const removeFresh = useCallback(
    (key: string) => {
      setFormError('');
      setFresh((previous) => {
        const removed = previous.find((item) => item.key === key);
        // Any sticker with a server id is already on the server (an upload
        // that landed before a partial failure), so it joins the removal
        // queue and is deleted on the next Save instead of orphaned.
        if (removed?.stickerId !== undefined) {
          const stickerId = removed.stickerId;
          setRemovedIds((previousIds) =>
            previousIds.includes(stickerId) ? previousIds : [...previousIds, stickerId],
          );
        }
        return previous.filter((item) => item.key !== key);
      });
    },
    [setFormError, setFresh],
  );

  const removeSaved = useCallback(
    (stickerId: string) => {
      setRemovedIds((previous) =>
        previous.includes(stickerId) ? previous : [...previous, stickerId],
      );
    },
    [setRemovedIds],
  );

  const changeEmoji = useCallback(
    (key: string, value: string) => {
      setFresh((previous) =>
        previous.map((row) => (row.key === key ? { ...row, emoji: value.slice(0, 8) } : row)),
      );
    },
    [setFresh],
  );

  // Edit order on Save: patch title/visibility, then deletions, then
  // uploads one by one (web order). A removed upload joins `removedIds`,
  // so the save loop deletes it (create-mode retry and edit mode alike).
  const save = useCallback(() => {
    if (busyRef.current || saving) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed === '') {
      setFormError('Name the pack first.');
      return;
    }
    if (fresh.some((item) => item.error !== undefined)) {
      setFormError('Retry or remove the failed stickers first.');
      return;
    }
    const pending = fresh.filter((item) => item.status !== 'uploaded');
    if (packId === undefined && createdPackIdRef.current === undefined && pending.length === 0) {
      setFormError('Add at least one sticker first.');
      return;
    }
    setFormError('');
    busyRef.current = true;
    setSaving(true);
    setProgress({ done: 0, total: pending.length });
    const snapshot = {
      title: trimmed,
      visibility,
      initialTitle,
      initialVisibility,
      removed: [...removedIds],
      pending: pending.map((item) => ({
        key: item.key,
        uri: item.uri,
        mimeType: item.mimeType,
        emoji: item.emoji,
      })),
      createdPackId: createdPackIdRef.current,
      createdTitle: createdTitleRef.current,
      createdVisibility: createdVisibilityRef.current,
    };
    const saveEffect = Effect.promise(() =>
      runSavePack({
        api,
        target:
          packId !== undefined
            ? { kind: 'edit', packId }
            : {
                kind: 'create',
                createdPackId: snapshot.createdPackId,
                createdTitle: snapshot.createdTitle,
                createdVisibility: snapshot.createdVisibility,
              },
        title: snapshot.title,
        visibility: snapshot.visibility,
        initialTitle: snapshot.initialTitle,
        initialVisibility: snapshot.initialVisibility,
        removedIds: snapshot.removed,
        pending: snapshot.pending,
        onRow: (key, status, error) => {
          setFresh((previous) =>
            previous.map((row) => {
              if (row.key !== key) {
                return row;
              }
              if (status === 'uploading') {
                return { ...row, status: 'uploading' as const, error: undefined };
              }
              if (status === 'uploaded') {
                return { ...row, status: 'uploaded' as const, stickerId: error };
              }
              return { ...row, status: 'uploadFailed' as const, error };
            }),
          );
        },
        onProgress: (done, total) => {
          setProgress({ done, total });
        },
        onRemovedFlushed: () => {
          setRemovedIds([]);
        },
        onCreated: (created) => {
          createdPackIdRef.current = created.id;
          createdTitleRef.current = created.title;
          createdVisibilityRef.current = created.visibility;
        },
      }),
    );
    Effect.runFork(
      saveEffect.pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            if (outcome.ok) {
              onSaved();
            } else if (outcome.partial) {
              // Brief §5: create mode keeps the minted pack across the retry (no
              // second pack) and the button flips to `Save`. The save stays
              // enabled because the uploaded rows are still in `fresh` (they
              // count as a change once the pack exists).
              if (outcome.created !== undefined) {
                createdPackIdRef.current = outcome.created.id;
                createdTitleRef.current = outcome.created.title;
                createdVisibilityRef.current = outcome.created.visibility;
                setCreatedPackId(outcome.created.id);
              }
            } else {
              setFormError(outcome.formError);
            }
            busyRef.current = false;
            setSaving(false);
            setProgress(undefined);
          }),
        ),
      ),
    );
  }, [
    api,
    busyRef,
    fresh,
    initialTitle,
    initialVisibility,
    onSaved,
    packId,
    removedIds,
    saving,
    title,
    visibility,
  ]);

  return {
    saved,
    setSaved,
    removedIds,
    fresh,
    preparing,
    skippedNote,
    count,
    packFull: count >= MAX_PACK_STICKERS,
    hasFailedRows: fresh.some((item) => item.error !== undefined),
    readyCount: fresh.filter((item) => item.status === 'ready' || item.status === 'uploadFailed')
      .length,
    visibleSaved,
    saving,
    progress,
    formError,
    createdPackId,
    pickImages,
    retryItem,
    removeFresh,
    removeSaved,
    changeEmoji,
    save,
  };
}
