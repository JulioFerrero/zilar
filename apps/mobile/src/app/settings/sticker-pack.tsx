import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Circle,
  CircleDot,
  Globe,
  ImagePlus,
  Lock,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as RNImage, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { Effect, Fiber } from 'effect';

import { useAuthStore } from '@/auth/session';
import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { API_URL } from '@/lib/auth';
import { asColorScheme } from '@/lib/color-scheme';
import { DANGER, FOREGROUND, ICON } from '@/lib/colors';
import { well } from '@/lib/depth';
import { getSessionToken } from '@/lib/session-token';
import { isSameOriginStickerUrl, stickerImageSource, type StickerItem } from '@/lib/stickers';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import {
  MAX_PACK_STICKERS,
  editorStickerCount,
  formatPreparedSize,
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
import { favoriteTileSize } from './stickers';

/**
 * Settings → sticker pack editor (T-0191): create mode without `id`, edit
 * mode with `?id=`. Edit order on Save: patch title/visibility, then
 * deletions, then uploads one by one (web order).
 */
export default function StickerPackScreen() {
  return (
    <RequireStickersAuth>
      <StickerPackBody />
    </RequireStickersAuth>
  );
}

type LoadStatus = 'loading' | 'ready' | 'load-error' | 'not-found' | 'forbidden';

const LOAD_ERROR = 'Could not load this pack.';
const NOT_FOUND = 'This pack was not found.';
const FORBIDDEN = 'You can only edit your own packs.';
const DELETE_ERROR = 'Could not delete the pack. Try again.';

export interface StickerPackScreenDeps {
  picker?: StickerImagePicker | undefined;
  preparer?: StickerImagePreparer | undefined;
}

function StickerPackBody({ picker, preparer }: StickerPackScreenDeps) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const packId = Array.isArray(params.id) ? params.id[0] : params.id;
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const { width: windowWidth } = useWindowDimensions();
  const { api } = useStickersApi();
  const me = useAuthStore((state) => state.me);
  const activePicker = useMemo(() => picker ?? createStickerImagePicker(), [picker]);
  const activePreparer = useMemo(() => preparer ?? createStickerPreparer(), [preparer]);

  const [status, setStatus] = useState<LoadStatus>(packId === undefined ? 'ready' : 'loading');
  const [title, setTitle] = useState('');
  const [initialTitle, setInitialTitle] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'server'>('private');
  const [initialVisibility, setInitialVisibility] = useState<'private' | 'server'>('private');
  const [importedFrom, setImportedFrom] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<StickerItem[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [fresh, setFresh] = useState<EditorNewItem[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [skippedNote, setSkippedNote] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>(undefined);
  const [token, setToken] = useState<string | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const busyRef = useRef(false);
  // Create mode: the pack minted on the first save. Kept across Save clicks
  // so a retry after a partial upload resumes into the same pack instead of
  // minting a second one (web's `createdPackIdRef`).
  const createdPackIdRef = useRef<string | undefined>(undefined);
  const createdTitleRef = useRef<string | undefined>(undefined);
  const createdVisibilityRef = useRef<'private' | 'server' | undefined>(undefined);
  // Brief §5: after a partial create save the screen stays open on the
  // minted pack and the button reads `Save`. Kept as state (not derived
  // from the ref during render) so the lint `react(refs)` rule holds and
  // the re-render after save flips the label.
  const [createdPackId, setCreatedPackId] = useState<string | undefined>(undefined);

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
            if (found.ownerId !== undefined && (me === null || found.ownerId !== me.id)) {
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
  }, [api, me, packId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const count = editorStickerCount(
    saved.filter((sticker) => !removedIds.includes(sticker.id)).length,
    fresh,
  );
  const packFull = count >= MAX_PACK_STICKERS;
  const hasFailedRows = fresh.some((item) => item.error !== undefined);
  const readyCount = fresh.filter(
    (item) => item.status === 'ready' || item.status === 'uploadFailed',
  ).length;
  // Brief §5: after a partial create save the screen stays open on the
  // minted pack, so the button reads `Save`.
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
  }, [changed, router, saving]);

  const pickImages = useCallback(() => {
    if (busyRef.current || saving) {
      return;
    }
    const slotsLeft = MAX_PACK_STICKERS - count;
    if (slotsLeft <= 0) {
      return;
    }
    setFormError('');
    const picker = activePicker;
    const preparer = activePreparer;
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
  }, [activePicker, activePreparer, count, saving]);

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
              router.back();
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
    fresh,
    initialTitle,
    initialVisibility,
    packId,
    removedIds,
    router,
    saving,
    title,
    visibility,
  ]);

  const retryItem = useCallback((key: string) => {
    setFormError('');
    setFresh((previous) =>
      previous.map((item) =>
        item.key === key ? { ...item, status: 'ready' as const, error: undefined } : item,
      ),
    );
  }, []);

  const removeFresh = useCallback((key: string) => {
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
  }, []);

  const removeSaved = useCallback((stickerId: string) => {
    setRemovedIds((previous) =>
      previous.includes(stickerId) ? previous : [...previous, stickerId],
    );
  }, []);

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

  const imported = importedFrom !== undefined;
  const visibilityDisabled = saving || imported;
  const saveDisabled =
    saving || preparing > 0 || hasFailedRows || (isCreate ? readyCount === 0 : !changed);
  const tile = favoriteTileSize(windowWidth);
  const visibleSaved = saved.filter((sticker) => !removedIds.includes(sticker.id));

  return (
    <SettingsScreenShell
      title={packId === undefined ? 'New pack' : 'Edit pack'}
      subtitle={
        packId === undefined ? 'Name it, pick images, save.' : title === '' ? undefined : title
      }
      onBack={onBack}
    >
      {status === 'loading' ? <StateMessage kind="loading" title="Loading pack…" /> : null}

      {status === 'load-error' ? (
        <StateMessage
          kind="error"
          title={LOAD_ERROR}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading pack',
            onPress: load,
          }}
        />
      ) : null}

      {status === 'not-found' || status === 'forbidden' ? (
        <View className="items-center gap-3 pt-12">
          <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
            {status === 'not-found' ? NOT_FOUND : FORBIDDEN}
          </Text>
          <Button
            variant="outline"
            size="sm"
            accessibilityLabel="Back to stickers"
            onPress={() => router.back()}
          >
            <Text>Back to stickers</Text>
          </Button>
        </View>
      ) : null}

      {status === 'ready' ? (
        <View className="gap-5">
          <View className="gap-1">
            <Text className="text-[14px] font-medium text-foreground">Pack name</Text>
            <TextField
              value={title}
              onChangeText={setTitle}
              maxLength={60}
              placeholder="My stickers"
              accessibilityLabel="Pack name"
              returnKeyType="done"
              editable={!saving}
              className="h-11"
              style={saving ? { opacity: 0.6 } : undefined}
            />
          </View>

          <View className="gap-1">
            <Text className="text-[14px] font-medium text-foreground">Who can find this pack</Text>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                selected: visibility === 'private',
                disabled: visibilityDisabled,
              }}
              accessibilityLabel="Private"
              disabled={visibilityDisabled}
              onPress={() => setVisibility('private')}
              className={`min-h-[52px] flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${
                visibility === 'private'
                  ? 'border-border-strong bg-surface-raised'
                  : 'border-border bg-surface'
              }`}
              style={{
                opacity: visibilityDisabled ? 0.6 : 1,
              }}
            >
              <Lock size={18} color={ICON[scheme]} />
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-medium text-foreground">Private</Text>
                <Text className="text-[13px] text-muted-foreground">
                  Only you can find a private pack. Stickers you already sent still show.
                </Text>
              </View>
              {visibility === 'private' ? (
                <CircleDot size={20} color={ICON[scheme]} />
              ) : (
                <Circle size={20} color={ICON[scheme]} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{
                selected: visibility === 'server',
                disabled: visibilityDisabled,
              }}
              accessibilityLabel="Shared on this server"
              disabled={visibilityDisabled}
              onPress={() => setVisibility('server')}
              className={`min-h-[52px] flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${
                visibility === 'server'
                  ? 'border-border-strong bg-surface-raised'
                  : 'border-border bg-surface'
              }`}
              style={{
                opacity: visibilityDisabled ? 0.6 : 1,
              }}
            >
              <Globe size={18} color={ICON[scheme]} />
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-medium text-foreground">
                  Shared on this server
                </Text>
                <Text className="text-[13px] text-muted-foreground">
                  Anyone on this server can find and add it.
                </Text>
              </View>
              {visibility === 'server' ? (
                <CircleDot size={20} color={ICON[scheme]} />
              ) : (
                <Circle size={20} color={ICON[scheme]} />
              )}
            </Pressable>
            {imported ? (
              <Text className="text-[13px] text-muted-foreground">
                Imported packs are for personal use, so they stay private and cannot be shared.
              </Text>
            ) : null}
          </View>

          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Text className="text-[16px] font-semibold text-foreground">Stickers</Text>
              <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
                {count} / 120
              </Text>
            </View>
            <View accessibilityLabel="Stickers in this pack" className="flex-row flex-wrap gap-2">
              {visibleSaved.map((sticker) => (
                <View
                  key={sticker.id}
                  className="items-center justify-center rounded-[10px] border border-border bg-surface p-1"
                  style={{ width: tile, height: tile }}
                >
                  {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                    <RNImage
                      source={stickerImageSource(sticker.url, API_URL, token)}
                      style={{ width: tile - 8, height: tile - 8 }}
                      resizeMode="contain"
                    />
                  ) : null}
                  {sticker.emoji !== null ? (
                    <Text className="absolute bottom-0.5 left-1 text-[11px] text-muted-foreground">
                      {sticker.emoji}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove sticker"
                    disabled={saving}
                    hitSlop={10}
                    onPress={() => removeSaved(sticker.id)}
                    className="absolute right-0.5 top-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/70 active:opacity-70 disabled:opacity-60"
                  >
                    <X size={12} color={FOREGROUND[scheme]} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add sticker images"
                disabled={saving || preparing > 0 || packFull}
                onPress={pickImages}
                className="items-center justify-center gap-1 rounded-[10px] border border-dashed border-border-strong bg-well disabled:opacity-60"
                style={{ width: tile, height: tile }}
              >
                <ImagePlus size={22} color={ICON[scheme]} />
                <Text className="text-[12px] text-muted-foreground">Add</Text>
              </Pressable>
            </View>
            {packId === undefined && visibleSaved.length === 0 && fresh.length === 0 ? (
              <Text className="text-[13px] text-muted-foreground">
                Pick PNG, JPEG, WebP or GIF images. Each is resized to fit 512 px.
              </Text>
            ) : null}
            {packFull ? (
              <Text className="text-[13px] text-muted-foreground">
                This pack is full. A pack holds up to 120 stickers.
              </Text>
            ) : null}
            {skippedNote ? (
              <Text className="text-[13px] text-muted-foreground">
                Only 120 stickers fit in a pack. Extra images were skipped.
              </Text>
            ) : null}
            {preparing > 0 ? (
              <StateMessage
                kind="loading"
                size="inline"
                title={preparing === 1 ? 'Preparing 1 image…' : `Preparing ${preparing} images…`}
              />
            ) : null}
            {fresh.length > 0 ? (
              <View className="gap-2">
                <Text className="text-[14px] font-medium text-foreground">New stickers</Text>
                {fresh.map((item, index) => (
                  <View
                    key={item.key}
                    className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-2"
                  >
                    {item.error !== undefined ? (
                      <View className="h-14 w-14 items-center justify-center rounded-lg bg-well">
                        <TriangleAlert size={22} color={DANGER} />
                      </View>
                    ) : (
                      <RNImage
                        source={{ uri: item.uri }}
                        style={{ width: 56, height: 56, borderRadius: 8 }}
                        resizeMode="contain"
                      />
                    )}
                    <View className="min-w-0 flex-1 gap-1">
                      {item.error !== undefined ? (
                        <Text accessibilityRole="alert" className="text-[13px] text-danger">
                          {item.error}
                        </Text>
                      ) : (
                        <Text className="text-[13px] text-muted-foreground">
                          {item.status === 'uploading'
                            ? 'Uploading…'
                            : item.status === 'uploaded'
                              ? 'Uploaded'
                              : 'Ready'}
                          {item.bytes > 0
                            ? ` · ${formatPreparedSize(item.width, item.height, item.bytes)}`
                            : ''}
                        </Text>
                      )}
                      {item.error === undefined &&
                      item.status !== 'uploading' &&
                      item.status !== 'uploaded' ? (
                        <View className="flex-row items-center gap-2">
                          <View className="h-9 w-14 justify-center rounded-lg px-2" style={well}>
                            <TextInput
                              value={item.emoji}
                              onChangeText={(value) =>
                                setFresh((previous) =>
                                  previous.map((row) =>
                                    row.key === item.key
                                      ? { ...row, emoji: value.slice(0, 8) }
                                      : row,
                                  ),
                                )
                              }
                              maxLength={8}
                              accessibilityLabel={`Emoji for sticker ${index + 1}`}
                              editable={!saving}
                              className="text-[16px] text-foreground"
                            />
                          </View>
                          <Text className="text-[13px] text-muted-foreground">Optional emoji</Text>
                        </View>
                      ) : null}
                    </View>
                    <View className="shrink-0 flex-row items-center gap-1">
                      {item.status === 'uploadFailed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          accessibilityLabel={`Retry sticker ${index + 1}`}
                          disabled={saving}
                          onPress={() => retryItem(item.key)}
                        >
                          <Text>Retry</Text>
                        </Button>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove new sticker ${index + 1}`}
                        disabled={saving}
                        onPress={() => removeFresh(item.key)}
                        className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised disabled:opacity-60"
                      >
                        <X size={18} color={ICON[scheme]} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {saving && progress !== undefined && progress.total > 0 ? (
            <View accessibilityLiveRegion="polite">
              <Text className="text-[14px] text-muted-foreground">
                Uploading {progress.done} of {progress.total}…
              </Text>
            </View>
          ) : null}
          {formError !== '' ? (
            <Text accessibilityRole="alert" className="text-[14px] text-danger">
              {formError}
            </Text>
          ) : null}

          <View className="flex-row items-center gap-2">
            <Button
              variant="default"
              size="sm"
              accessibilityLabel={isCreate ? 'Create pack' : 'Save'}
              disabled={saveDisabled}
              onPress={save}
            >
              <Text>{saving ? 'Saving…' : isCreate ? 'Create pack' : 'Save'}</Text>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              accessibilityLabel="Cancel"
              disabled={saving}
              onPress={onBack}
            >
              <Text>Cancel</Text>
            </Button>
          </View>

          {packId !== undefined ? (
            <View className="gap-2 border-t border-divider pt-4">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${title === '' ? 'pack' : title}`}
                disabled={saving}
                onPress={askDelete}
                className="h-11 flex-row items-center justify-center gap-2 rounded-full border border-danger disabled:opacity-60"
              >
                <Trash2 size={16} color={DANGER} />
                <Text className="text-[15px] font-medium text-danger">Delete pack</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete this pack?"
        message="The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker."
        error={deleteError}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={deleting}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        confirmAccessibilityLabel={title === '' ? 'Delete pack' : `Delete ${title}`}
        destructive
      />

      <ConfirmDialog
        visible={discardAsk}
        title="Discard changes?"
        message="Your changes to this pack are not saved."
        confirmLabel="Discard"
        busyLabel="Discard"
        busy={false}
        onCancel={() => setDiscardAsk(false)}
        onConfirm={() => {
          setDiscardAsk(false);
          router.back();
        }}
        cancelLabel="Keep editing"
        cancelAccessibilityLabel="Keep editing"
        destructive
      />
    </SettingsScreenShell>
  );
}
