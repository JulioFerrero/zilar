import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Effect } from 'effect';

import { useAuthStore } from '@/auth/session';
import {
  MAX_PACK_STICKERS,
  editorStickerCount,
  lookupFailureKind,
  nextEditorKey,
  runDeletePack,
  runSavePack,
  takeFittingImages,
  type EditorNewItem,
} from '@/components/stickers/pack-editor';
import {
  createStickerImagePicker,
  createStickerPreparer,
  type PickedStickerImage,
  type StickerImagePicker,
  type StickerImagePreparer,
} from '@/components/stickers/sticker-native';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { interruptFiber } from '@zilar/client-core';
import { getSessionToken } from '@/lib/session-token';
import type { StickerItem } from '@/lib/stickers';

export type PackVisibility = 'private' | 'server';

export type LoadStatus = 'loading' | 'ready' | 'load-error' | 'not-found' | 'forbidden';

const DELETE_ERROR = 'Could not delete the pack. Try again.';

export interface PackEditorDeps {
  picker?: StickerImagePicker | undefined;
  preparer?: StickerImagePreparer | undefined;
}

export function usePackEditor({ picker, preparer }: PackEditorDeps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const packId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { api, viewerId } = useStickersApi();
  const me = useAuthStore((state) => state.me);
  // In mock mode the seeded viewer wins: a stored session from an earlier sign-in
  // may still be present, and `me.id` would never match the seed owner.
  const viewer = viewerId ?? me?.id;
  const activePicker = useMemo(() => picker ?? createStickerImagePicker(), [picker]);
  const activePreparer = useMemo(() => preparer ?? createStickerPreparer(), [preparer]);

  const [status, setStatus] = useState<LoadStatus>(packId === undefined ? 'ready' : 'loading');
  const [title, setTitle] = useState('');
  const [initialTitle, setInitialTitle] = useState('');
  const [visibility, setVisibility] = useState<PackVisibility>('private');
  const [initialVisibility, setInitialVisibility] = useState<PackVisibility>('private');
  const [importedFrom, setImportedFrom] = useState<string | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const busyRef = useRef(false);
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.promise(() => getSessionToken()).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            setToken(value);
          }),
        ),
      ),
    );
    return () => {
      interruptFiber(fiber);
    };
  }, []);

  const onSaved = useCallback(() => {
    router.back();
  }, [router]);

  const [saved, setSaved] = useState<StickerItem[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [fresh, setFresh] = useState<EditorNewItem[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [skippedNote, setSkippedNote] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined);
  // Create mode: the pack minted on the first save, kept across Save clicks so a
  // retry after a partial upload resumes into the same pack.
  const createdPackIdRef = useRef<string | undefined>(undefined);
  const createdTitleRef = useRef<string | undefined>(undefined);
  const createdVisibilityRef = useRef<PackVisibility | undefined>(undefined);
  // Brief §5: after a partial create save the screen stays open on the minted pack
  // and the button reads `Save`. State (not a ref) keeps the lint `react(refs)` rule.
  const [createdPackId, setCreatedPackId] = useState<string | undefined>(undefined);

  const visibleSaved = saved.filter((sticker) => !removedIds.includes(sticker.id));
  const count = editorStickerCount(visibleSaved.length, fresh);
  const packFull = count >= MAX_PACK_STICKERS;
  const hasFailedRows = fresh.some((item) => item.error !== undefined);
  const readyCount = fresh.filter(
    (item) => item.status === 'ready' || item.status === 'uploadFailed',
  ).length;

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
    const prepareEach = (picked: readonly PickedStickerImage[]): Effect.Effect<void> =>
      Effect.forEach(
        picked,
        (image) =>
          Effect.promise(() => activePreparer.prepare(image)).pipe(
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
      Effect.promise(() => activePicker.pickImages()).pipe(
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
  }, [activePicker, activePreparer, busyRef, count, saving, setFormError]);

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
        // Any sticker with a server id is already on the server, so a removal
        // queues it for the next Save instead of orphaning it.
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

  // Edit order on Save: patch title/visibility, then deletions, then uploads one
  // by one (web order). A removed upload joins `removedIds`.
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

  const load = useCallback(() => {
    if (packId === undefined) {
      return;
    }
    // A reload over a shown pack keeps it on screen; only a load with nothing
    // shown paints the loading state.
    setStatus((previous) => (previous === 'ready' ? previous : 'loading'));
    // The raw error is kept (no ApiFailure mapping): lookupFailureKind checks
    // ApiError by class.
    Effect.runFork(
      Effect.tryPromise({
        try: () => api.listStickerPacks(),
        catch: (error: unknown) => error,
      }).pipe(
        Effect.tap((panel) =>
          Effect.sync(() => {
            const found = panel.find((pack) => pack.id === packId);
            if (found === undefined) {
              setStatus('not-found');
              return;
            }
            if (found.ownerId !== undefined && found.ownerId !== viewer) {
              setStatus('forbidden');
              return;
            }
            setTitle(found.title);
            setInitialTitle(found.title);
            const nextVisibility = found.visibility ?? 'private';
            setVisibility(nextVisibility);
            setInitialVisibility(nextVisibility);
            setImportedFrom(found.importedFrom);
            setSaved(found.stickers);
            setStatus('ready');
          }),
        ),
        Effect.catch((error: unknown) =>
          Effect.sync(() => {
            const kind = lookupFailureKind(error);
            if (kind === 'not-found') {
              setStatus('not-found');
              return;
            }
            // T-1978: a failed background reload keeps the shown pack.
            setStatus((previous) => (previous === 'ready' ? previous : 'load-error'));
          }),
        ),
      ),
    );
  }, [api, packId, setSaved, viewer]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isCreate = packId === undefined && createdPackId === undefined;
  const changed = isCreate
    ? readyCount > 0
    : title.trim() !== initialTitle.trim() ||
      visibility !== initialVisibility ||
      removedIds.length > 0 ||
      fresh.length > 0;

  const onBack = useCallback(() => {
    if (saving) {
      return;
    }
    if (changed) {
      setDiscardAsk(true);
      return;
    }
    router.back();
  }, [changed, saving, router]);

  const askDelete = useCallback(() => {
    setDeleteError('');
    setConfirmingDelete(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (packId === undefined || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setDeleting(true);
    setDeleteError('');
    Effect.runFork(
      Effect.promise(() => runDeletePack(api, packId)).pipe(
        Effect.tap((deleted) =>
          Effect.sync(() => {
            if (deleted) {
              setConfirmingDelete(false);
              router.back();
            } else {
              setDeleteError(DELETE_ERROR);
            }
            busyRef.current = false;
            setDeleting(false);
          }),
        ),
      ),
    );
  }, [api, packId, router]);

  const cancelDelete = useCallback(() => {
    setConfirmingDelete(false);
  }, []);

  const keepEditing = useCallback(() => {
    setDiscardAsk(false);
  }, []);

  const discard = useCallback(() => {
    setDiscardAsk(false);
    router.back();
  }, [router]);

  const imported = importedFrom !== undefined;
  const visibilityDisabled = saving || imported;
  const saveDisabled =
    saving || preparing > 0 || hasFailedRows || (isCreate ? readyCount === 0 : !changed);

  return {
    packId,
    status,
    title,
    setTitle,
    visibility,
    setVisibility,
    imported,
    visibilityDisabled,
    count,
    packFull,
    preparing,
    skippedNote,
    fresh,
    visibleSaved,
    token,
    saving,
    progress,
    formError,
    isCreate,
    saveDisabled,
    load,
    save,
    onBack,
    pickImages,
    retryItem,
    removeFresh,
    removeSaved,
    changeEmoji,
    confirmingDelete,
    deleteError,
    deleting,
    askDelete,
    confirmDelete,
    cancelDelete,
    discardAsk,
    keepEditing,
    discard,
  };
}
