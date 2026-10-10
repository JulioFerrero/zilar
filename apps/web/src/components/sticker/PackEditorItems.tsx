import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useRef } from 'react';
import { formatStickerSize } from '@/lib/sticker-images';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { BlobPreview } from './BlobPreview';
import { isEmojiLike, type PackEditorItem } from './packEditorModel';

export interface PackEditorItemsProps {
  items: PackEditorItem[];
  busy: boolean;
  onMove: (key: string, direction: -1 | 1) => void;
  onMoveByIndex: (from: number, to: number) => void;
  onRetry: (key: string) => void;
  onSetEmoji: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}

/** The sticker rows: preview, emoji, drag plus Up/Down, retry and remove. */
export function PackEditorItems({
  items,
  busy,
  onMove,
  onMoveByIndex,
  onRetry,
  onSetEmoji,
  onRemove,
}: PackEditorItemsProps) {
  const dragIndexRef = useRef<number | undefined>(undefined);

  if (items.length === 0) {
    return null;
  }

  return (
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
            onMoveByIndex(from, index);
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
                  onChange={(event) => onSetEmoji(item.key, event.target.value)}
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
              onClick={() => onMove(item.key, -1)}
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
              onClick={() => onMove(item.key, 1)}
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
                onClick={() => onRetry(item.key)}
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
              onClick={() => onRemove(item.key)}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </span>
        </li>
      ))}
    </ol>
  );
}
