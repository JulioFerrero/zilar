import { Data, Effect } from 'effect';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createStickerPack,
  deletePackSticker,
  patchStickerPack,
  uploadStickerFile,
  type Sticker,
  type StickerPack,
} from '@/lib/api';
import { formatStickerSize, prepareStickerImage, PrepError } from '@/lib/sticker-images';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from '@/components/ui/text-input';

export type PackEditorItemStatus = 'ready' | 'uploading' | 'done' | 'error';

export interface PackEditorItem {
  key: string;
  name: string;
  /** New items only: the prepared bytes (previewed through `BlobPreview`). */
  blob?: Blob | undefined;
  /** Existing stickers only: the server file URL shown directly. */
  serverUrl?: string | undefined;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  bytes: number;
  emoji: string;
  status: PackEditorItemStatus;
  error?: string | undefined;
  /** The server id: set for existing stickers, and for new ones once uploaded. */
  stickerId?: string | undefined;
}

export interface PackEditorProps {
  /** Absent = create mode (the pack is created first, then stickers upload). */
  packId?: string | undefined;
  initialTitle?: string | undefined;
  initialVisibility?: 'private' | 'server' | undefined;
  /** The pack's current stickers in edit mode (shown first, removable, reorderable). */
  initialStickers?: Sticker[] | undefined;
  onDone: (packId: string) => void;
  onCancel: () => void;
  /** Injected in tests so no canvas is touched. */
  prepare?: typeof prepareStickerImage;
  createPack?: typeof createStickerPack;
  uploadFile?: typeof uploadStickerFile;
  patchPack?: typeof patchStickerPack;
  deleteSticker?: typeof deletePackSticker;
}

export const PACK_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

let editorKey = 0;
function nextKey(): string {
  editorKey += 1;
  return `sticker-${editorKey}`;
}

/** A single emoji (one grapheme cluster): ZWJ and flag sequences stay whole. */
export function takeSingleEmoji(value: string): string {
  if (value === '') {
    return '';
  }
  if (typeof Intl.Segmenter === 'function') {
    const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value);
    return segments.containing(0)?.segment ?? '';
  }
  return Array.from(value).slice(0, 1).join('');
}

function isEmojiLike(value: string): boolean {
  return value !== '' && /\p{Extended_Pictographic}/u.test(value);
}

function describePrepError(error: unknown, name: string): string {
  if (error instanceof PrepError) {
    return error.message;
  }
  return `${name}: the image could not be prepared.`;
}

/**
 * A call that failed. It keeps the thrown value whole, so a row or the form
 * shows the thrown Error's own message, as the editor always did.
 */
class CallFailed extends Data.TaggedError('PackCallFailed')<{ readonly error: unknown }> {}

/** Lifts one Promise call (an api.ts function or an injected one) into an Effect. */
function call<A>(run: () => Promise<A>): Effect.Effect<A, CallFailed> {
  return Effect.tryPromise({ try: run, catch: (error) => new CallFailed({ error }) });
}

/** The text of a failed call: the thrown Error's message, else the fixed sentence. */
function messageOf(failure: CallFailed, fallback: string): string {
  return failure.error instanceof Error ? failure.error.message : fallback;
}

/** One picked file, prepared. A failure becomes an error row, never a lost file. */
function prepareItem(
  file: File,
  prepare: typeof prepareStickerImage,
): Effect.Effect<PackEditorItem> {
  const name = file.name !== '' ? file.name : 'image';
  return call(() => prepare(file)).pipe(
    Effect.match({
      onFailure: (failure): PackEditorItem => ({
        key: nextKey(),
        name,
        mime: 'image/webp',
        width: 0,
        height: 0,
        bytes: 0,
        emoji: '',
        status: 'error',
        error: describePrepError(failure.error, name),
      }),
      onSuccess: (prepared): PackEditorItem => ({
        key: nextKey(),
        name,
        blob: prepared.blob,
        mime: prepared.mime,
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.bytes,
        emoji: '',
        status: 'ready',
      }),
    }),
  );
}

interface PrepareBatchJob {
  readonly key: string;
  readonly files: File[];
}

/**
 * The files of one drop, prepared one after another as before. Each drop is
 * its own batch, so two drops still prepare side by side; the batch leaves
 * the list once its last file is in. The Effect starts on mount and stops
 * when the batch unmounts.
 */
function PrepareBatch({
  files,
  prepare,
  onPrepared,
  onFinished,
}: {
  files: File[];
  prepare: typeof prepareStickerImage;
  onPrepared: (item: PackEditorItem) => void;
  onFinished: () => void;
}) {
  // The latest prepare prop, kept current on render (the pattern of use-action.ts).
  const latestPrepare = useRef(prepare);
  useLayoutEffect(() => {
    latestPrepare.current = prepare;
  });
  // The drop starts on mount and reads the prepare function then, so a drop
  // always uses the prop the editor had when the files were picked.
  useQuery(
    () =>
      Effect.sync(() => latestPrepare.current).pipe(
        Effect.flatMap((currentPrepare) =>
          Effect.forEach(
            files,
            (file) =>
              prepareItem(file, currentPrepare).pipe(
                Effect.tap((item) => Effect.sync(() => onPrepared(item))),
              ),
            { discard: true },
          ),
        ),
        Effect.andThen(Effect.sync(() => onFinished())),
      ),
    [],
  );
  return null;
}

/**
 * One prepared sticker's preview. The object URL is owned by this node:
 * created on mount (or when the blob changes) and revoked when the node
 * leaves or the blob is replaced — so a URL is never revoked while its
 * `<img>` still shows it, and a StrictMode remount recreates instead of
 * reusing a revoked URL. A browser without `createObjectURL` gets the
 * placeholder the editor always had.
 */
function BlobPreview({ blob, alt }: { blob: Blob; alt: string }) {
  // Created once per mount (never in an effect, so no set-state-in-effect):
  // the blob per item never changes, and a StrictMode remount recreates
  // instead of reusing a revoked URL.
  // A browser (or a test DOM) that refuses the blob gets the placeholder: the
  // refusal is caught by the Effect, not by a try block here.
  const [url] = useState(() =>
    Effect.runSync(
      Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => '')),
    ),
  );
  useEffect(
    () => () => {
      if (url !== '') {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );
  if (url === '') {
    return <span className="text-[13px] text-muted-foreground">…</span>;
  }
  return <img src={url} alt={alt} className="max-h-16 max-w-16 object-contain" />;
}

/** What Save sends: the click-time values, so the save never reads a half-edited form. */
interface SaveInput {
  readonly title: string;
  readonly visibility: 'private' | 'server';
  readonly items: ReadonlyArray<PackEditorItem>;
}

/**
 * The sticker pack editor (T-0121): title, visibility, a drop zone / file
 * picker that prepares several images at once, per-sticker emoji / remove /
 * reorder (drag plus Up/Down buttons), then a sequential upload with
 * per-file retry.
 *
 * T-0152: rendered inside the centered settings column (the caller wraps it
 * in the page's column class), so the form uses the full column width.
 */
export function PackEditor({
  packId,
  initialTitle = '',
  initialVisibility = 'private',
  initialStickers = [],
  onDone,
  onCancel,
  prepare = prepareStickerImage,
  createPack: createPackFn = createStickerPack,
  uploadFile = uploadStickerFile,
  patchPack: patchPackFn = patchStickerPack,
  deleteSticker: deleteStickerFn = deletePackSticker,
}: PackEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [visibility, setVisibility] = useState<'private' | 'server'>(initialVisibility);
  const [items, setItems] = useState<PackEditorItem[]>(() =>
    initialStickers.map((sticker, index) => ({
      key: `existing-${sticker.id}`,
      name: sticker.emoji ?? `Sticker ${index + 1}`,
      serverUrl: sticker.url,
      mime: sticker.mime,
      width: sticker.width,
      height: sticker.height,
      bytes: sticker.bytes,
      emoji: sticker.emoji ?? '',
      status: 'done' as const,
      stickerId: sticker.id,
    })),
  );
  const initialIdsRef = useRef(initialStickers.map((sticker) => sticker.id));
  const removedIdsRef = useRef<string[]>([]);
  // Create mode: the pack minted on the first save, plus the title and
  // visibility it was created with. Kept across Save clicks so a retry
  // after a partial upload resumes into the same pack instead of minting a
  // second one — and a title/visibility change since the creation is
  // patched onto it rather than silently dropped.
  const createdPackIdRef = useRef<string | undefined>(undefined);
  const createdTitleRef = useRef<string | undefined>(undefined);
  const createdVisibilityRef = useRef<'private' | 'server' | undefined>(undefined);
  // The save loop reads the list at order-PATCH time, not from its
  // click-time snapshot, so the patch always matches the finished UI.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [preparing, setPreparing] = useState(0);
  const [batches, setBatches] = useState<PrepareBatchJob[]>([]);
  const [formError, setFormError] = useState('');
  const [doneCount, setDoneCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragIndexRef = useRef<number | undefined>(undefined);

  const addFiles = (files: FileList | File[]): void => {
    const list = Array.from(files);
    if (list.length === 0) {
      return;
    }
    setPreparing((count) => count + list.length);
    setBatches((previous) => [...previous, { key: nextKey(), files: list }]);
  };

  const finishPreparing = (item: PackEditorItem): void => {
    setItems((previous) => [...previous, item]);
    setPreparing((count) => count - 1);
  };

  const removeBatch = (key: string): void => {
    setBatches((previous) => previous.filter((batch) => batch.key !== key));
  };

  const removeItem = (key: string): void => {
    setItems((previous) => {
      const removed = previous.find((item) => item.key === key);
      // Any sticker with a server id is deleted on save in edit mode — an
      // existing row, or one uploaded earlier in this session (it keeps its
      // blob, but the server already has it, so it must leave the order
      // patch and be deleted).
      if (removed?.stickerId !== undefined) {
        removedIdsRef.current = [...removedIdsRef.current, removed.stickerId];
      }
      return previous.filter((item) => item.key !== key);
    });
  };

  const moveItem = (key: string, direction: -1 | 1): void => {
    setItems((previous) => {
      const index = previous.findIndex((item) => item.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  };

  const setEmoji = (key: string, value: string): void => {
    const emoji = takeSingleEmoji(value);
    setItems((previous) => previous.map((item) => (item.key === key ? { ...item, emoji } : item)));
  };

  const retryItem = (key: string): void => {
    setItems((previous) =>
      previous.map((item) =>
        item.key === key ? { ...item, status: 'ready' as const, error: undefined } : item,
      ),
    );
  };

  const updateRow = (key: string, patch: Partial<PackEditorItem>): void => {
    setItems((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  // Each landed delete leaves the queue at once, so a retry after a later
  // failure does not 404 on an already-deleted sticker.
  const flushRemovals = (pack: string): Effect.Effect<void, CallFailed> => {
    const removedIds = removedIdsRef.current;
    removedIdsRef.current = [];
    return Effect.forEach(
      removedIds,
      (stickerId) =>
        call(() => deleteStickerFn(pack, stickerId)).pipe(
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
        createPackFn({ title: input.title, visibility: input.visibility }),
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
        yield* call(() => patchPackFn(pack, { title: input.title, visibility: input.visibility }));
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
        yield* call(() => patchPackFn(pack, { title: input.title, visibility: input.visibility }));
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
          yield* call(() => patchPackFn(finalId, { order: currentIds }));
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

  const readyCount = items.filter((item) => item.status === 'ready').length;
  // Save stays disabled while any error row exists: the user retries or
  // removes it first, so a re-save can never skip a failed file and close
  // as success. `save()` re-checks the same condition defensively.
  const errorCount = items.filter((item) => item.error !== undefined).length;
  const progress =
    busy && activeCount > 0 ? `Uploading ${doneCount} of ${activeCount}…` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Pack name</span>
        <TextInput
          value={title}
          maxLength={60}
          placeholder="My stickers"
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>

      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <legend className="text-[14px] font-medium">Who can find this pack</legend>
        <SegmentedControl
          mode="radio"
          ariaLabel="Who can find this pack"
          options={[
            { value: 'private', label: 'Private' },
            { value: 'server', label: 'Shared on this server' },
          ]}
          value={visibility}
          onChange={(next) => {
            if (next !== 'private' && next !== 'server') {
              return;
            }
            setVisibility(next);
          }}
        />
        <p className="text-[13px] text-muted-foreground">
          {visibility === 'server'
            ? 'Shared packs can be found and added by anyone on this server.'
            : 'Only you can find a private pack. Stickers you already sent still show.'}
        </p>
      </fieldset>

      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Add sticker images"
        aria-disabled={busy}
        onClick={() => {
          if (!busy) {
            fileInputRef.current?.click();
          }
        }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !busy) {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy && event.dataTransfer?.files !== undefined) {
            addFiles(event.dataTransfer.files);
          }
        }}
        className={cn(
          'flex flex-col items-center gap-1 rounded-xl border border-dashed border-border-strong bg-well px-4 py-6 text-center',
          busy ? 'cursor-default opacity-60' : 'cursor-pointer',
        )}
      >
        <span className="text-[15px] font-medium">Drop images here or pick files</span>
        <span className="text-[13px] text-muted-foreground">
          PNG, JPEG, WebP or GIF (first frame). Each becomes at most 512 px and 512 KiB.
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={PACK_ACCEPT}
          multiple
          disabled={busy}
          aria-label="Pick sticker images"
          className="sr-only"
          onChange={(event) => {
            if (event.target.files !== null) {
              addFiles(event.target.files);
              event.target.value = '';
            }
          }}
        />
      </div>
      {preparing > 0 && (
        <p className="text-[13px] text-muted-foreground">Preparing {preparing} image…</p>
      )}
      {batches.map((batch) => (
        <PrepareBatch
          key={batch.key}
          files={batch.files}
          prepare={prepare}
          onPrepared={finishPreparing}
          onFinished={() => removeBatch(batch.key)}
        />
      ))}

      {items.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Stickers in this pack">
          {items.map((item, index) => (
            <li
              key={item.key}
              draggable={item.error === undefined && !busy}
              onDragStart={() => {
                dragIndexRef.current = index;
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                const from = dragIndexRef.current;
                dragIndexRef.current = undefined;
                if (from === undefined || from === index || busy) {
                  return;
                }
                setItems((previous) => {
                  const next = [...previous];
                  const [moved] = next.splice(from, 1);
                  next.splice(index, 0, moved!);
                  return next;
                });
              }}
              className="flex items-center gap-3 rounded-xl border border-divider bg-background p-2"
            >
              {item.error === undefined ? (
                <span className="checkerboard flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg">
                  {item.blob !== undefined ? (
                    <BlobPreview blob={item.blob} alt={item.name} />
                  ) : item.serverUrl !== undefined ? (
                    <img
                      src={item.serverUrl}
                      alt={item.name}
                      className="max-h-16 max-w-16 object-contain"
                    />
                  ) : (
                    <span className="text-[13px] text-muted-foreground">…</span>
                  )}
                </span>
              ) : (
                <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-well text-[20px]">
                  ⚠️
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[14px] font-medium">{item.name}</span>
                {item.error !== undefined ? (
                  <span role="alert" className="text-[13px] text-danger">
                    {item.error}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    {formatStickerSize(item.width, item.height, item.bytes)}
                    {item.status === 'uploading' && ' · Uploading…'}
                    {item.status === 'done' && ' · Uploaded'}
                  </span>
                )}
                {item.error === undefined && item.blob !== undefined && (
                  <label className="flex items-center gap-1 text-[13px]">
                    <span className="text-muted-foreground">Emoji</span>
                    <TextInput
                      value={item.emoji}
                      maxLength={8}
                      placeholder="🐱"
                      disabled={busy}
                      aria-label={`Emoji for ${item.name}`}
                      onChange={(event) => setEmoji(item.key, event.target.value)}
                      invalid={item.emoji !== '' && !isEmojiLike(item.emoji)}
                      className="w-14 px-2 py-1"
                    />
                  </label>
                )}
                {item.error === undefined && item.blob === undefined && item.emoji !== '' && (
                  <span className="text-[13px] text-muted-foreground">Emoji {item.emoji}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${item.name} up`}
                  disabled={index === 0 || busy}
                  onClick={() => moveItem(item.key, -1)}
                  className="text-muted-foreground"
                >
                  <ChevronUp className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === items.length - 1 || busy}
                  onClick={() => moveItem(item.key, 1)}
                  className="text-muted-foreground"
                >
                  <ChevronDown className="size-4" aria-hidden="true" />
                </Button>
                {item.status === 'error' && item.blob !== undefined ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => retryItem(item.key)}
                    className="text-muted-foreground"
                  >
                    Retry
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.name}`}
                  disabled={busy}
                  onClick={() => removeItem(item.key)}
                  className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {progress !== undefined && (
        <p role="status" className="text-[14px] text-muted-foreground">
          {progress}
        </p>
      )}
      {shownFormError !== '' && (
        <p role="alert" className="text-[14px] text-danger">
          {shownFormError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={
            busy || preparing > 0 || errorCount > 0 || (packId === undefined && readyCount === 0)
          }
          onClick={save}
          size="lg"
        >
          {packId === undefined ? 'Create pack' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
