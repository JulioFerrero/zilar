import {
  PACK_ACCEPT,
  PrepareBatch,
  type PackEditorItem,
  type PrepareBatchJob,
  type PrepareSticker,
  nextKey,
  takeSingleEmoji,
  type PackEditorProps,
} from './sticker/packEditorModel';
import { TilePopover } from './sticker/TilePopover';
import { usePackSave } from './sticker/usePackSave';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from '@/components/ui/text-input';
import {
  createStickerPack,
  deletePackSticker,
  patchStickerPack,
  uploadStickerFile,
} from '@/lib/api';
import { prepareStickerImage } from '@/lib/sticker-images';
import { STICKERS_MAX_PER_PACK } from '@zilar/api-contract';
import { Plus, Lock, Globe } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';

interface PackEditorItemsProps {
  items: PackEditorItem[];
  busy: boolean;
  onMove: (key: string, direction: -1 | 1) => void;
  onRetry: (key: string) => void;
  onSetEmoji: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onPickFiles: () => void;
}

function PackEditorItems({
  items,
  busy,
  onMove,
  onRetry,
  onSetEmoji,
  onRemove,
  onPickFiles,
}: PackEditorItemsProps) {
  return (
    <ul aria-label="Stickers in this pack" className="grid grid-cols-4 gap-2.5 sm:grid-cols-6">
      {items.map((item, index) => (
        <TilePopover
          key={item.key}
          item={item}
          index={index}
          count={items.length}
          busy={busy}
          onMove={onMove}
          onRetry={onRetry}
          onSetEmoji={onSetEmoji}
          onRemove={onRemove}
        />
      ))}

      {items.length < STICKERS_MAX_PER_PACK && (
        <li>
          <button
            type="button"
            aria-label="Add photos, GIFs or videos"
            disabled={busy}
            onClick={onPickFiles}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-border-strong text-[13px] font-medium text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus className="size-5" aria-hidden="true" />
            Add
          </button>
        </li>
      )}
    </ul>
  );
}

export type {
  PackEditorItem,
  PackEditorItemStatus,
  PackEditorProps,
} from './sticker/packEditorModel';
export { PACK_ACCEPT, takeSingleEmoji } from './sticker/packEditorModel';

interface PackEditorFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  visibility: 'private' | 'server';
  onVisibilityChange: (value: 'private' | 'server') => void;
  busy: boolean;
  count: number;
  preparing: number;
  batches: PrepareBatchJob[];
  prepare: PrepareSticker;
  onAddFiles: (files: FileList | File[]) => void;
  onPrepared: (item: PackEditorItem) => void;
  onBatchFinished: (key: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

function PackEditorForm({
  title,
  onTitleChange,
  visibility,
  onVisibilityChange,
  busy,
  count,
  preparing,
  batches,
  prepare,
  onAddFiles,
  onPrepared,
  onBatchFinished,
  fileInputRef,
}: PackEditorFormProps) {
  return (
    <>
      <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[14px] font-medium">Name</span>
          <TextInput
            value={title}
            maxLength={60}
            placeholder="My stickers"
            disabled={busy}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>

        <fieldset disabled={busy} className="w-[220px] shrink-0">
          <SegmentedControl
            mode="radio"
            ariaLabel="Who can find this pack"
            options={[
              { value: 'private', label: 'Private', icon: Lock },
              { value: 'server', label: 'Shared', icon: Globe },
            ]}
            value={visibility}
            onChange={(next) => {
              if (next !== 'private' && next !== 'server') {
                return;
              }
              onVisibilityChange(next);
            }}
          />
        </fieldset>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">Stickers</span>
        <span className="font-mono text-[12px] text-subtle-foreground">
          {count} / {STICKERS_MAX_PER_PACK}
        </span>
      </div>

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
            onAddFiles(event.target.files);
            event.target.value = '';
          }
        }}
      />
      {preparing > 0 && (
        <p className="text-[13px] text-muted-foreground">Preparing {preparing} image…</p>
      )}
      {batches.map((batch) => (
        <PrepareBatch
          key={batch.key}
          files={batch.files}
          prepare={prepare}
          onPrepared={onPrepared}
          onFinished={() => onBatchFinished(batch.key)}
        />
      ))}
    </>
  );
}

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
  // The save loop reads the list at PATCH time so the order matches the finished UI.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [preparing, setPreparing] = useState(0);
  const [batches, setBatches] = useState<PrepareBatchJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // Every sticker with a server id is deleted on save in edit mode, including one uploaded this session.
      if (removed?.stickerId !== undefined) {
        removedIdsRef.current = [...removedIdsRef.current, removed.stickerId];
      }
      return previous.filter((item) => item.key !== key);
    });
  };

  const moveByIndex = (from: number, to: number): void => {
    setItems((previous) => {
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const moveItem = (key: string, direction: -1 | 1): void => {
    const index = items.findIndex((item) => item.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) {
      return;
    }
    moveByIndex(index, target);
  };

  const updateRow = (key: string, patch: Partial<PackEditorItem>): void => {
    setItems((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const setEmoji = (key: string, value: string): void => {
    updateRow(key, { emoji: takeSingleEmoji(value) });
  };

  const retryItem = (key: string): void => {
    updateRow(key, { status: 'ready', error: undefined });
  };

  const { save, busy, shownFormError, progress } = usePackSave({
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
    createPack: createPackFn,
    uploadFile,
    patchPack: patchPackFn,
    deleteSticker: deleteStickerFn,
  });

  const readyCount = items.filter((item) => item.status === 'ready').length;
  // Save stays disabled while any error row exists, so a re-save never skips a failed file.
  const errorCount = items.filter((item) => item.error !== undefined).length;
  const saveDisabled =
    busy || preparing > 0 || errorCount > 0 || (packId === undefined && readyCount === 0);

  return (
    <SettingsShell
      title={packId === undefined ? 'New pack' : 'Edit pack'}
      onBack={onCancel}
      action={
        <Button type="button" size="lg" disabled={saveDisabled} onClick={save}>
          {packId === undefined ? 'Create' : 'Save'}
        </Button>
      }
    >
      <div
        className={SETTINGS_COLUMN}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy && event.dataTransfer?.files !== undefined) {
            addFiles(event.dataTransfer.files);
          }
        }}
      >
        <PackEditorForm
          title={title}
          onTitleChange={setTitle}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          busy={busy}
          count={items.length}
          preparing={preparing}
          batches={batches}
          prepare={prepare}
          onAddFiles={addFiles}
          onPrepared={finishPreparing}
          onBatchFinished={removeBatch}
          fileInputRef={fileInputRef}
        />

        <PackEditorItems
          items={items}
          busy={busy}
          onMove={moveItem}
          onRetry={retryItem}
          onSetEmoji={setEmoji}
          onRemove={removeItem}
          onPickFiles={() => fileInputRef.current?.click()}
        />

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
      </div>
    </SettingsShell>
  );
}
