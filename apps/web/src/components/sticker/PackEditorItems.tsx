import { Plus } from 'lucide-react';
import { STICKERS_MAX_PER_PACK } from '@zilar/api-contract';
import type { PackEditorItem } from './packEditorModel';
import { TilePopover } from './TilePopover';

export interface PackEditorItemsProps {
  items: PackEditorItem[];
  busy: boolean;
  onMove: (key: string, direction: -1 | 1) => void;
  onRetry: (key: string) => void;
  onSetEmoji: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  /** Opens the hidden file picker the Add tile stands for. */
  onPickFiles: () => void;
}

/**
 * The pack's stickers as a grid of square tiles (T-1509), ending in a dashed
 * Add tile. A tile shows its emoji, a loop badge when it moves, a spinner
 * while it uploads or its error; clicking it opens `TilePopover`.
 */
export function PackEditorItems({
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
