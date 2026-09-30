import { useEffect, useMemo, useRef, useState } from 'react';
import type { StickerPack } from '@/lib/api';
import { discoverStickerPacks, listStickerPacks } from '@/lib/api';
import { isPanelStickerUrl, readRecentStickers, rememberRecentSticker } from '@/lib/stickers';
import type { RecentStickerEntry } from '@/lib/stickers';
import { cn } from '@/lib/utils';

export interface StickerChoice {
  stickerId: string;
  packId: string;
  url: string;
  emoji?: string | undefined;
  width: number;
  height: number;
  mime: 'image/webp' | 'image/png';
}

export interface StickerPanelProps {
  onPick: (sticker: StickerChoice) => void;
  onClose: () => void;
}

/**
 * A panel thumbnail: same-origin sticker URLs (and the mock demo packs'
 * generated `data:` art) load lazily; anything else (e.g. a hostile URL
 * planted in localStorage recents) shows the emoji tile so the browser
 * never fetches it.
 */
function StickerThumb({ sticker, size }: { sticker: StickerChoice; size: number }) {
  const trusted = isPanelStickerUrl(sticker.url);
  const label = sticker.emoji ?? 'Sticker';
  if (!trusted) {
    return (
      <span
        role="img"
        aria-label={label}
        className="flex items-center justify-center text-[26px]"
        style={{ width: size, height: size }}
      >
        {label === 'Sticker' ? '🙂' : label}
      </span>
    );
  }
  return (
    <img
      src={sticker.url}
      alt={label}
      loading="lazy"
      width={size}
      height={size}
      style={{ maxWidth: size, maxHeight: size }}
      className="object-contain"
    />
  );
}

type Tab = 'stickers' | 'gifs' | 'emoji';

const COMMON_EMOJI = [
  '😀',
  '😂',
  '🥰',
  '😎',
  '🤔',
  '👍',
  '👎',
  '🙏',
  '👏',
  '🔥',
  '❤️',
  '💔',
  '🎉',
  '😢',
  '😮',
  '😡',
  '🤝',
  '👀',
  '💯',
  '✨',
  '🚀',
  '🍻',
  '☕',
  '🌙',
  '☀️',
  '👋',
  '💪',
  '🙌',
  '🤷',
  '😴',
] as const;

/**
 * The sticker panel in the composer (T-0120): tabs Stickers / GIFs / Emoji,
 * a strip of pack tabs (first: Recent), a 6-column grid of 72 px stickers,
 * hover/keyboard focus preview, click sends. GIFs show "Coming soon" until
 * T-0122; the Emoji tab appends a common emoji to the draft.
 */
export function StickerPanel({
  onPick,
  onClose,
  onEmoji,
}: StickerPanelProps & { onEmoji: (emoji: string) => void }) {
  const [tab, setTab] = useState<Tab>('stickers');
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);
  const [recents, setRecents] = useState<RecentStickerEntry[]>(() => {
    try {
      return readRecentStickers(window.localStorage);
    } catch {
      return [];
    }
  });
  const [preview, setPreview] = useState<StickerChoice | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listStickerPacks()
      .then((loaded) => {
        if (!cancelled) {
          setPacks(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPacks([]);
        }
      });
    // Discover is best-effort: server packs are browsable even before T-0121.
    discoverStickerPacks()
      .then((page) => {
        if (!cancelled && page.packs.length > 0) {
          setPacks((previous) => {
            const known = new Set((previous ?? []).map((pack) => pack.id));
            return [...(previous ?? []), ...page.packs.filter((pack) => !known.has(pack.id))];
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeStickers: StickerChoice[] = useMemo(() => {
    if (activePackId === undefined || activePackId === 'recent') {
      return recents.map((recent) => ({
        stickerId: recent.stickerId,
        packId: recent.packId,
        url: recent.url,
        ...(recent.emoji === undefined ? {} : { emoji: recent.emoji }),
        width: 200,
        height: 200,
        mime: 'image/webp' as const,
      }));
    }
    const pack = packs?.find((item) => item.id === activePackId);
    return (
      pack?.stickers.map((sticker) => ({
        stickerId: sticker.id,
        packId: sticker.packId,
        url: sticker.url,
        ...(sticker.emoji === null ? {} : { emoji: sticker.emoji }),
        width: sticker.width,
        height: sticker.height,
        mime: sticker.mime,
      })) ?? []
    );
  }, [activePackId, packs, recents]);

  const pick = (sticker: StickerChoice): void => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    setRecents(
      rememberRecentSticker(storage, {
        stickerId: sticker.stickerId,
        packId: sticker.packId,
        url: sticker.url,
        ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
      }),
    );
    onPick(sticker);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Stickers"
      className="absolute bottom-full left-0 z-20 mb-2 w-[340px] rounded-[14px] border border-edge bg-surface shadow-lg"
    >
      <div role="tablist" aria-label="Panel tabs" className="flex gap-1 border-b border-edge p-2">
        {(['stickers', 'gifs', 'emoji'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              'rounded-[8px] px-3 py-1.5 text-[13px] font-medium',
              tab === name ? 'bg-surface-raised text-foreground' : 'text-muted-foreground',
            )}
          >
            {name === 'stickers' ? 'Stickers' : name === 'gifs' ? 'GIFs' : 'Emoji'}
          </button>
        ))}
      </div>

      {tab === 'gifs' && (
        <div className="flex h-[220px] items-center justify-center text-[13px] text-muted-foreground">
          Coming soon
        </div>
      )}

      {tab === 'emoji' && (
        <div
          className="grid max-h-[260px] grid-cols-6 gap-1 overflow-y-auto p-2"
          role="grid"
          aria-label="Emoji"
        >
          {COMMON_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`Insert ${emoji}`}
              onClick={() => onEmoji(emoji)}
              className="flex h-[48px] items-center justify-center rounded-[8px] text-[26px] hover:bg-surface-raised"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {tab === 'stickers' && (
        <>
          <div
            className="flex gap-1 overflow-x-auto border-b border-edge p-2"
            role="tablist"
            aria-label="Sticker packs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activePackId === undefined || activePackId === 'recent'}
              onClick={() => setActivePackId('recent')}
              className={cn(
                'shrink-0 rounded-[8px] px-2.5 py-1 text-[12px]',
                activePackId === undefined || activePackId === 'recent'
                  ? 'bg-surface-raised text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              Recent
            </button>
            {(packs ?? []).map((pack) => (
              <button
                key={pack.id}
                type="button"
                role="tab"
                aria-selected={activePackId === pack.id}
                title={pack.title}
                onClick={() => setActivePackId(pack.id)}
                className={cn(
                  'max-w-[120px] shrink-0 truncate rounded-[8px] px-2.5 py-1 text-[12px]',
                  activePackId === pack.id
                    ? 'bg-surface-raised text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {pack.title}
              </button>
            ))}
          </div>

          {activeStickers.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center px-4 text-center text-[13px] text-muted-foreground">
              {packs === undefined
                ? 'Loading stickers…'
                : 'No stickers yet. Packs you add will show here.'}
            </div>
          ) : (
            <div
              className="grid max-h-[260px] grid-cols-6 gap-1 overflow-y-auto p-2"
              role="grid"
              aria-label="Stickers"
            >
              {activeStickers.map((sticker) => (
                <button
                  key={sticker.stickerId}
                  type="button"
                  aria-label={sticker.emoji ?? 'Sticker'}
                  title={sticker.emoji ?? 'Sticker'}
                  onClick={() => pick(sticker)}
                  onMouseEnter={() => setPreview(sticker)}
                  onFocus={() => setPreview(sticker)}
                  onMouseLeave={() => setPreview(undefined)}
                  onBlur={() => setPreview(undefined)}
                  className="flex size-[72px] items-center justify-center rounded-[8px] hover:bg-surface-raised focus-visible:bg-surface-raised"
                >
                  <StickerThumb sticker={sticker} size={64} />
                </button>
              ))}
            </div>
          )}

          {preview !== undefined && isPanelStickerUrl(preview.url) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-2 left-1/2 flex -translate-x-1/2 -translate-y-full items-center justify-center rounded-[12px] border border-edge bg-surface p-2 shadow-lg"
            >
              <img
                src={preview.url}
                alt=""
                width={160}
                height={160}
                className="max-h-[160px] max-w-[160px] object-contain"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
