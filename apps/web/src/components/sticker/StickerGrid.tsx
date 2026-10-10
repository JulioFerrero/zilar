import { useState } from 'react';
import { Plus, Star } from 'lucide-react';
import type { StickerPack } from '@/lib/api';
import { isPanelStickerUrl } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { StickerChoice } from '../StickerPanel';
import { FavoriteStar } from './FavoriteStar';
import { StickerThumb } from './StickerThumb';

export interface StickerGridProps {
  activeStickers: StickerChoice[];
  favoriteIds: ReadonlySet<string>;
  packs: StickerPack[] | undefined;
  activePackId: string | undefined;
  onSelectPack: (packId: string) => void;
  favoriteError: string;
  onPick: (sticker: StickerChoice) => void;
  onApplyFavorite: (sticker: StickerChoice, wasStarred: boolean) => void;
  onUndoFavorite: (sticker: StickerChoice, wasStarred: boolean) => void;
  onCreate: (() => void) | undefined;
  onManage: (() => void) | undefined;
}

// The sticker grid: 5 columns of fixed 56 px square tiles inside a
// min-344px panel (5 x 56 + 4 x 8 gap + 2 x 8 padding = 328 px, leaving
// room for the scrollbar), so tiles never overlap. The image stays
// object-contain inside its tile with breathing room (T-0155: `p-1.5`,
// so the star's backdrop corner never touches the art) and the star is a
// small corner button fully inside the tile.
const TILE_PX = 56;

/** The Stickers tab body: pack tabs, the tile grid, the hover preview and the manage link. */
export function StickerGrid({
  activeStickers,
  favoriteIds,
  packs,
  activePackId,
  onSelectPack,
  favoriteError,
  onPick,
  onApplyFavorite,
  onUndoFavorite,
  onCreate,
  onManage,
}: StickerGridProps) {
  const [preview, setPreview] = useState<StickerChoice | undefined>(undefined);

  return (
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
          onClick={() => onSelectPack('recent')}
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
            onClick={() => onSelectPack(pack.id)}
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
        <button
          type="button"
          role="tab"
          aria-selected={activePackId === 'favorites'}
          aria-label="Favorites"
          title="Favorites"
          onClick={() => onSelectPack('favorites')}
          className={cn(
            'shrink-0 rounded-[8px] px-2.5 py-1 text-[12px]',
            activePackId === 'favorites'
              ? 'bg-surface-raised text-foreground'
              : 'text-muted-foreground',
          )}
        >
          <Star
            className={cn('size-3.5', activePackId === 'favorites' && 'fill-current')}
            aria-hidden="true"
          />
        </button>
        {onCreate !== undefined && (
          <button
            type="button"
            role="tab"
            aria-selected={false}
            aria-label="Create sticker pack"
            title="Create sticker pack"
            onClick={onCreate}
            className="shrink-0 rounded-[8px] px-2.5 py-1 text-[12px] text-muted-foreground"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {favoriteError !== '' && (
        <p role="alert" className="px-2 pt-1 text-[12px] text-danger">
          {favoriteError}
        </p>
      )}

      {activeStickers.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center px-4 text-center text-[13px] text-muted-foreground">
          {packs === undefined
            ? 'Loading stickers…'
            : activePackId === 'favorites'
              ? 'No favorites yet. Star a sticker to keep it here.'
              : 'No stickers yet. Packs you add will show here.'}
        </div>
      ) : (
        <div
          data-testid="sticker-grid"
          className="grid max-h-[260px] grid-cols-5 gap-2 overflow-y-auto p-2"
          role="grid"
          aria-label="Stickers"
        >
          {activeStickers.map((sticker) => {
            const starred = favoriteIds.has(sticker.stickerId);
            return (
              <span
                key={sticker.stickerId}
                className="relative inline-flex size-[56px] shrink-0 justify-self-center"
              >
                <button
                  type="button"
                  aria-label={sticker.emoji ?? 'Sticker'}
                  title={sticker.emoji ?? 'Sticker'}
                  onClick={() => onPick(sticker)}
                  onMouseEnter={() => setPreview(sticker)}
                  onFocus={() => setPreview(sticker)}
                  onMouseLeave={() => setPreview(undefined)}
                  onBlur={() => setPreview(undefined)}
                  style={{ width: TILE_PX, height: TILE_PX }}
                  className="flex items-center justify-center overflow-hidden rounded-[8px] p-1.5 focus-visible:bg-surface-raised hover:bg-surface-raised"
                >
                  <StickerThumb sticker={sticker} size={TILE_PX - 12} />
                </button>
                <FavoriteStar
                  sticker={sticker}
                  starred={starred}
                  onApply={onApplyFavorite}
                  onUndo={onUndoFavorite}
                />
              </span>
            );
          })}
        </div>
      )}

      {preview !== undefined && isPanelStickerUrl(preview.url) && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-2 right-0 flex -translate-y-full items-center justify-center rounded-[12px] border border-edge bg-surface p-2 shadow-lg"
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

      {onManage !== undefined && (
        <div className="border-t border-edge p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onManage}
            className="w-full text-muted-foreground"
          >
            Manage stickers
          </Button>
        </div>
      )}
    </>
  );
}
