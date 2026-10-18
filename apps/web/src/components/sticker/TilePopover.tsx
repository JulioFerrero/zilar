import { Popover } from '@base-ui/react/popover';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Plus,
  Repeat,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { TextInput } from '@/components/ui/text-input';
import { cn } from '@/lib/utils';
import type { PackEditorItem } from './packEditorModel';
import { Effect } from 'effect';

/**
 * The object URL is owned by this node: created on mount and revoked when it
 * leaves. StrictMode's throwaway setup/cleanup/setup would revoke the URL the
 * element still shows, so the cleanup defers the revoke by a microtask and the
 * next setup cancels it; a real unmount has no setup, so the revoke stands.
 */
function BlobPreview({
  blob,
  alt,
  video,
}: {
  blob: Blob;
  alt: string;
  video?: boolean | undefined;
}) {
  const [url] = useState(() =>
    Effect.runSync(
      Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => '')),
    ),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current && url !== '') {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [url]);
  if (url === '') {
    return <span className="text-[13px] text-muted-foreground">…</span>;
  }
  if (video === true) {
    return (
      <video
        src={url}
        muted
        loop
        autoPlay
        playsInline
        className="max-h-16 max-w-16 object-contain"
        aria-label={alt}
      />
    );
  }
  return <img src={url} alt={alt} className="max-h-16 max-w-16 object-contain" />;
}

const EMOJI_POOL = ['😀', '😂', '😍', '😎', '👍', '🙌', '🔥', '❤️'];
const EMOJI_SLOTS = 7;

function emojiChoices(current: string): string[] {
  const ordered =
    current === '' ? EMOJI_POOL : [current, ...EMOJI_POOL.filter((emoji) => emoji !== current)];
  return ordered.slice(0, EMOJI_SLOTS);
}

export interface TilePopoverProps {
  item: PackEditorItem;
  index: number;
  count: number;
  busy: boolean;
  onMove: (key: string, direction: -1 | 1) => void;
  onRetry: (key: string) => void;
  onSetEmoji: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}

export function TilePopover({
  item,
  index,
  count,
  busy,
  onMove,
  onRetry,
  onSetEmoji,
  onRemove,
}: TilePopoverProps) {
  const [open, setOpen] = useState(false);
  const [moreEmoji, setMoreEmoji] = useState(false);
  const moving = item.motion !== undefined && item.motion !== 'none';
  const uploading = item.status === 'uploading';
  const errored = item.error !== undefined;
  const label =
    item.error !== undefined ? item.error : item.emoji !== '' ? item.emoji : `Sticker ${index + 1}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <li className="relative aspect-square">
        <Popover.Trigger
          aria-label={label}
          className={cn(
            'relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] border bg-surface outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            errored ? 'border-danger/60' : 'border-border',
            open && 'ring-2 ring-foreground',
          )}
        >
          <span
            className={cn(
              'absolute inset-[14%] flex items-center justify-center [&_img]:size-full [&_img]:max-h-none [&_img]:max-w-none [&_img]:object-contain [&_video]:size-full [&_video]:max-h-none [&_video]:max-w-none [&_video]:object-contain',
              uploading ? 'opacity-35' : errored ? 'opacity-40' : '',
            )}
          >
            {item.blob !== undefined ? (
              <BlobPreview blob={item.blob} alt={item.name} video={item.motion === 'video'} />
            ) : item.serverUrl !== undefined ? (
              <img src={item.serverUrl} alt={item.name} />
            ) : (
              <span className="text-[13px] text-muted-foreground">…</span>
            )}
          </span>

          {moving && (
            <span
              role="img"
              aria-label="Moves"
              className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-md bg-background/85"
            >
              <Repeat className="size-3" aria-hidden="true" />
            </span>
          )}

          <span className="absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-background text-[13px] leading-none">
            {item.emoji === '' ? (
              <Plus className="size-3 text-subtle-foreground" role="img" aria-label="No emoji" />
            ) : (
              item.emoji
            )}
          </span>

          {uploading && (
            <Loader2
              role="img"
              aria-label="Uploading"
              className="size-6 animate-spin text-foreground"
            />
          )}

          {errored && <CircleAlert className="size-6 text-danger" aria-hidden="true" />}
        </Popover.Trigger>

        {errored && (
          <IconButton
            size={24}
            radius={8}
            aria-label="Remove"
            disabled={busy}
            onClick={() => onRemove(item.key)}
            className="absolute right-1.5 top-1.5 z-10"
          >
            <X className="size-3" aria-hidden="true" />
          </IconButton>
        )}
      </li>

      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            aria-label={`Sticker ${index + 1}`}
            className="w-[300px] rounded-[12px] border border-border-strong bg-surface p-2.5 shadow-[0_16px_32px_-8px_rgba(0,0,0,0.95)] outline-none"
          >
            {errored && (
              <div className="mb-2 flex flex-col gap-2">
                <p role="alert" className="text-[13px] text-danger">
                  {item.error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onRetry(item.key)}
                >
                  Try again
                </Button>
              </div>
            )}

            <div className="grid grid-cols-8 gap-1">
              {emojiChoices(item.emoji).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={emoji}
                  aria-pressed={emoji === item.emoji}
                  onClick={() => onSetEmoji(item.key, emoji)}
                  className={cn(
                    'flex h-8 items-center justify-center rounded-lg text-[18px] leading-none',
                    emoji === item.emoji ? 'bg-surface-raised' : 'hover:bg-surface-raised',
                  )}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                aria-label="More emoji"
                aria-expanded={moreEmoji}
                onClick={() => setMoreEmoji((value) => !value)}
                className={cn(
                  'flex h-8 items-center justify-center rounded-lg text-muted-foreground',
                  moreEmoji ? 'bg-surface-raised' : 'hover:bg-surface-raised',
                )}
              >
                <Search className="size-4" aria-hidden="true" />
              </button>
            </div>

            {moreEmoji && (
              <TextInput
                value={item.emoji}
                maxLength={8}
                placeholder="Emoji"
                aria-label="Custom emoji"
                className="mt-1"
                onChange={(event) => onSetEmoji(item.key, event.target.value)}
              />
            )}

            <div className="mt-2.5 flex items-center gap-1.5 border-t border-divider pt-2">
              <IconButton
                aria-label="Move left"
                disabled={index === 0 || busy}
                onClick={() => onMove(item.key, -1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label="Move right"
                disabled={index === count - 1 || busy}
                onClick={() => onMove(item.key, 1)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </IconButton>
              <span className="flex-1" />
              <IconButton
                aria-label="Remove sticker"
                disabled={busy}
                onClick={() => onRemove(item.key)}
                className="text-danger"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
