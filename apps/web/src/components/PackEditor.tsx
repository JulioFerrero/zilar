import { useEffect, useRef, useState } from 'react';
import {
  createStickerPack,
  deletePackSticker,
  patchStickerPack,
  uploadStickerFile,
} from '@/lib/api';
import { prepareStickerImage } from '@/lib/sticker-images';
import { Button } from '@/components/ui/button';
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
  // The save loop reads the list at order-PATCH time, not from its
  // click-time snapshot, so the patch always matches the finished UI.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [preparing, setPreparing] = useState(0);
  const [batches, setBatches] = useState<PrepareBatchJob[]>([]);

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

  // One move for the Up/Down buttons and a drag-drop (the T-0981 dedup).
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
  // Save stays disabled while any error row exists: the user retries or
  // removes it first, so a re-save can never skip a failed file and close
  // as success. `save()` re-checks the same condition defensively.
  const errorCount = items.filter((item) => item.error !== undefined).length;

  return (
    <div className="flex flex-col gap-4">
      <PackEditorForm
        title={title}
        onTitleChange={setTitle}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        busy={busy}
        preparing={preparing}
        batches={batches}
        prepare={prepare}
        onAddFiles={addFiles}
        onPrepared={finishPreparing}
        onBatchFinished={removeBatch}
      />

      <PackEditorItems
        items={items}
        busy={busy}
        onMove={moveItem}
        onMoveByIndex={moveByIndex}
        onRetry={retryItem}
        onSetEmoji={setEmoji}
        onRemove={removeItem}
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
