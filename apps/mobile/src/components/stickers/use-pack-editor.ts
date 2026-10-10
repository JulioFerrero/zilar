import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Effect, Fiber } from 'effect';

import { useAuthStore } from '@/auth/session';
import {
  lookupFailureKind,
  runDeletePack,
  type EditorNewItem,
} from '@/components/stickers/pack-editor';
import {
  createStickerImagePicker,
  createStickerPreparer,
  type StickerImagePicker,
  type StickerImagePreparer,
} from '@/components/stickers/sticker-native';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { usePackItems, type PackVisibility } from '@/components/stickers/use-pack-items';
import { getSessionToken } from '@/lib/session-token';
import type { StickerItem } from '@/lib/stickers';

export type { PackVisibility };

export type LoadStatus = 'loading' | 'ready' | 'load-error' | 'not-found' | 'forbidden';

const DELETE_ERROR = 'Could not delete the pack. Try again.';

export interface PackEditorDeps {
  picker?: StickerImagePicker | undefined;
  preparer?: StickerImagePreparer | undefined;
}

export interface PackEditor {
  packId: string | undefined;
  status: LoadStatus;
  title: string;
  setTitle: (value: string) => void;
  visibility: PackVisibility;
  setVisibility: (value: PackVisibility) => void;
  imported: boolean;
  visibilityDisabled: boolean;
  count: number;
  packFull: boolean;
  preparing: number;
  skippedNote: boolean;
  fresh: EditorNewItem[];
  visibleSaved: StickerItem[];
  token: string | undefined;
  saving: boolean;
  progress: { done: number; total: number } | undefined;
  formError: string;
  isCreate: boolean;
  saveDisabled: boolean;
  load: () => void;
  save: () => void;
  onBack: () => void;
  pickImages: () => void;
  retryItem: (key: string) => void;
  removeFresh: (key: string) => void;
  removeSaved: (stickerId: string) => void;
  changeEmoji: (key: string, value: string) => void;
  confirmingDelete: boolean;
  deleteError: string;
  deleting: boolean;
  askDelete: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  discardAsk: boolean;
  keepEditing: () => void;
  discard: () => void;
}

/**
 * The pack editor's state and handlers: the load, the delete and the back
 * guard, plus the sticker items and Save loop behind `use-pack-items.ts`.
 * The route keeps the default export, the shell and the load states.
 */
export function usePackEditor({ picker, preparer }: PackEditorDeps): PackEditor {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const packId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { api, viewerId } = useStickersApi();
  const me = useAuthStore((state) => state.me);
  // In mock mode the seeded viewer wins: a stored session from an earlier
  // sign-in may still be present, and `me.id` would never match the seed owner.
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
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  const onSaved = useCallback(() => {
    router.back();
  }, [router]);

  const items = usePackItems({
    picker: activePicker,
    preparer: activePreparer,
    api,
    packId,
    title,
    visibility,
    initialTitle,
    initialVisibility,
    busyRef,
    onSaved,
  });
  const { setSaved } = items;

  const load = useCallback(() => {
    if (packId === undefined) {
      return;
    }
    setStatus('loading');
    // The raw error is kept (no ApiFailure mapping): lookupFailureKind
    // checks StickersApiError by class.
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
            setStatus(kind === 'not-found' ? 'not-found' : 'load-error');
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

  const isCreate = packId === undefined && items.createdPackId === undefined;
  const changed = isCreate
    ? items.readyCount > 0
    : title.trim() !== initialTitle.trim() ||
      visibility !== initialVisibility ||
      items.removedIds.length > 0 ||
      items.fresh.length > 0;

  const onBack = useCallback(() => {
    if (items.saving) {
      return;
    }
    if (changed) {
      setDiscardAsk(true);
      return;
    }
    router.back();
  }, [changed, items.saving, router]);

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
  const visibilityDisabled = items.saving || imported;
  const saveDisabled =
    items.saving ||
    items.preparing > 0 ||
    items.hasFailedRows ||
    (isCreate ? items.readyCount === 0 : !changed);

  return {
    packId,
    status,
    title,
    setTitle,
    visibility,
    setVisibility,
    imported,
    visibilityDisabled,
    count: items.count,
    packFull: items.packFull,
    preparing: items.preparing,
    skippedNote: items.skippedNote,
    fresh: items.fresh,
    visibleSaved: items.visibleSaved,
    token,
    saving: items.saving,
    progress: items.progress,
    formError: items.formError,
    isCreate,
    saveDisabled,
    load,
    save: items.save,
    onBack,
    pickImages: items.pickImages,
    retryItem: items.retryItem,
    removeFresh: items.removeFresh,
    removeSaved: items.removeSaved,
    changeEmoji: items.changeEmoji,
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
