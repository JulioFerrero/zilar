import { useEffect, useRef, useState } from 'react';
import {
  createStickerPack,
  deletePackSticker,
  patchStickerPack,
  uploadStickerFile,
} from '@/lib/api';
import { prepareStickerImage } from '@/lib/sticker-images';
import { Button } from '@/components/ui/button';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { PackEditorForm } from './sticker/PackEditorForm';
import { PackEditorItems } from './sticker/PackEditorItems';
import {
  nextKey,
  takeSingleEmoji,
  type PackEditorItem,
  type PackEditorProps,
  type PrepareBatchJob,
} from './sticker/packEditorModel';
import { usePackSave } from './sticker/usePackSave';

export type {
  PackEditorItem,
  PackEditorItemStatus,
  PackEditorProps,
} from './sticker/packEditorModel';
export { PACK_ACCEPT, takeSingleEmoji } from './sticker/packEditorModel';

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
