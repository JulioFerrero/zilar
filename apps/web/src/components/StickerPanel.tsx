import { Effect } from 'effect';
import { Plus, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GifPanel } from './GifPanel';
import type { GifItem, StickerChoice, RecentStickerEntry } from '@zilar/chat-core';
import type { Sticker, StickerPack } from '@/lib/api';
import {
  addStickerFavorite,
  discoverStickerPacks,
  listStickerFavorites,
  listStickerPacks,
  removeStickerFavorite,
  trendingGifs,
} from '@/lib/api';
import { fromApi, probeGifsAvailability } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { gifsAvailability, isStickerFileUrl } from '@zilar/chat-core';
import { forgetRecentSticker, rememberRecentSticker } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmojiTab } from './sticker/EmojiTab';
import { panelStorage, readStoredRecents, StickerThumb } from './sticker/StickerThumb';

export interface StickerPanelProps {
  onPick: (sticker: StickerChoice) => void;
  onClose: () => void;
  onEmoji: (emoji: string) => void;
  onGifPick: (gif: GifItem) => void;
  onManage?: (() => void) | undefined;
  onCreate?: (() => void) | undefined;
  gifsTab?: 'show' | 'hide' | undefined;
}

type Tab = 'emoji' | 'stickers' | 'gifs';

const PANEL_TABS: readonly Tab[] = ['emoji', 'stickers', 'gifs'] as const;

function toChoice(source: Sticker | RecentStickerEntry): StickerChoice {
  if ('stickerId' in source) {
    return {
      stickerId: source.stickerId,
      packId: source.packId,
      url: source.url,
      ...(source.emoji === undefined ? {} : { emoji: source.emoji }),
      width: 200,
      height: 200,
      mime: 'image/webp',
    };
  }
  return {
    stickerId: source.id,
    packId: source.packId,
    url: source.url,
    ...(source.emoji === null ? {} : { emoji: source.emoji }),
    width: source.width,
    height: source.height,
    mime: source.mime,
  };
}

function favoriteFrom(choice: StickerChoice): Sticker {
  return {
    id: choice.stickerId,
    packId: choice.packId,
    emoji: choice.emoji ?? null,
    mime: choice.mime,
    width: choice.width,
    height: choice.height,
    bytes: 0,
    url: choice.url,
  };
}

/**
 * The request is uninterruptible: a row leaves the list at once when its
 * favorite is removed on the Favorites tab, and a failed request must still
 * roll back.
 */
function FavoriteStar({
  sticker,
  starred,
  onApply,
  onUndo,
}: {
  sticker: StickerChoice;
  starred: boolean;
  onApply: (sticker: StickerChoice, wasStarred: boolean) => void;
  onUndo: (sticker: StickerChoice, wasStarred: boolean) => void;
}) {
  const [, toggle] = useAction((wasStarred: boolean) =>
    Effect.sync(() => onApply(sticker, wasStarred)).pipe(
      Effect.andThen(
        Effect.uninterruptible(
          (wasStarred
            ? fromApi(() => removeStickerFavorite(sticker.stickerId))
            : fromApi(() => addStickerFavorite(sticker.stickerId))
          ).pipe(Effect.tapError(() => Effect.sync(() => onUndo(sticker, wasStarred)))),
        ),
      ),
    ),
  );

  return (
    <button
      type="button"
      aria-label={
        starred
          ? `Unfavorite ${sticker.emoji ?? 'sticker'}`
          : `Favorite ${sticker.emoji ?? 'sticker'}`
      }
      aria-pressed={starred}
      title={starred ? 'Remove from favorites' : 'Add to favorites'}
      onClick={() => toggle(starred)}
      className={cn(
        'absolute top-0.5 right-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-edge bg-black/70 text-[10px] leading-none',
        starred ? 'text-white' : 'text-muted-foreground opacity-80',
      )}
    >
      <Star className={cn('size-3', starred && 'fill-current')} aria-hidden="true" />
    </button>
  );
}

// 5 columns of fixed 56 px tiles inside a min-344px panel (5 x 56 + 4 x 8 gap
// + 2 x 8 padding = 328 px, leaving room for the scrollbar), so tiles never
// overlap. `p-1.5` keeps the star's backdrop off the art.
const TILE_PX = 56;

function StickerGrid({
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
  onBrokenRecent,
}: {
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
  onBrokenRecent?: ((stickerId: string) => void) | undefined;
}) {
  const [preview, setPreview] = useState<StickerChoice | undefined>(undefined);
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | undefined>(undefined);
  const recentTab = activePackId === undefined || activePackId === 'recent';

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
                  <StickerThumb
                    sticker={sticker}
                    size={TILE_PX - 12}
                    onBroken={
                      recentTab && onBrokenRecent !== undefined
                        ? () => onBrokenRecent(sticker.stickerId)
                        : undefined
                    }
                  />
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

      {preview !== undefined &&
        isStickerFileUrl(preview.url, window.location.origin) &&
        preview.url !== failedPreviewUrl && (
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
              onError={() => setFailedPreviewUrl(preview.url)}
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

/**
 * Composer sticker panel: Emoji, Stickers and GIFs tabs; GIF search goes
 * through the privacy-preserving proxy. Fixed to the viewport's bottom-right
 * so it stays inside narrow windows.
 */
export function StickerPanel({
  onPick,
  onClose,
  onEmoji,
  onGifPick,
  onManage,
  onCreate,
  gifsTab,
}: StickerPanelProps) {
  const [tab, setTab] = useState<Tab>('emoji');
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);
  const [favorites, setFavorites] = useState<Sticker[] | undefined>(undefined);
  const [favoriteError, setFavoriteError] = useState('');
  const [recents, setRecents] = useState<RecentStickerEntry[]>(readStoredRecents);
  // The GIFs tab hides on a 501 (provider off); the probe runs once per
  // session, and a hidden active tab falls back to Emoji.
  const gifsProbeNeeded = gifsTab === undefined;
  const [gifsEnabled, setGifsEnabled] = useState<boolean | undefined>(() => {
    if (gifsTab !== undefined) {
      return gifsTab === 'show';
    }
    return gifsAvailability();
  });

  useQuery(
    () =>
      gifsProbeNeeded
        ? probeGifsAvailability(trendingGifs).pipe(
            Effect.tap((available) => Effect.sync(() => setGifsEnabled(available))),
          )
        : Effect.void,
    [gifsProbeNeeded],
  );

  const visibleTab: Tab = tab === 'gifs' && gifsEnabled === false ? 'emoji' : tab;

  useQuery(
    () =>
      fromApi(() => listStickerPacks()).pipe(
        Effect.tap((loaded) => Effect.sync(() => setPacks(loaded))),
        Effect.catchTag('ApiFailure', () => Effect.sync(() => setPacks([]))),
      ),
    [],
  );

  useQuery(
    () =>
      fromApi(() => discoverStickerPacks()).pipe(
        Effect.tap((page) =>
          Effect.sync(() => {
            if (page.packs.length > 0) {
              setPacks((previous) => {
                const known = new Set((previous ?? []).map((pack) => pack.id));
                return [...(previous ?? []), ...page.packs.filter((pack) => !known.has(pack.id))];
              });
            }
          }),
        ),
        Effect.ignore,
      ),
    [],
  );

  useQuery(
    () =>
      fromApi(() => listStickerFavorites()).pipe(
        Effect.tap((starred) => Effect.sync(() => setFavorites(starred))),
        Effect.ignore,
      ),
    [],
  );

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
    if (activePackId === 'favorites') {
      return (favorites ?? []).map(toChoice);
    }
    if (activePackId === undefined || activePackId === 'recent') {
      return recents.map(toChoice);
    }
    const pack = packs?.find((item) => item.id === activePackId);
    return pack?.stickers.map(toChoice) ?? [];
  }, [activePackId, favorites, packs, recents]);

  const pick = (sticker: StickerChoice): void => {
    setRecents(
      rememberRecentSticker(panelStorage(), {
        stickerId: sticker.stickerId,
        packId: sticker.packId,
        url: sticker.url,
        ...(sticker.emoji === undefined ? {} : { emoji: sticker.emoji }),
      }),
    );
    onPick(sticker);
  };

  const favoriteIds = useMemo(
    () => new Set((favorites ?? []).map((sticker) => sticker.id)),
    [favorites],
  );

  const applyFavorite = (sticker: StickerChoice, wasStarred: boolean): void => {
    setFavoriteError('');
    setFavorites((previous) => {
      if (wasStarred) {
        return (previous ?? []).filter((row) => row.id !== sticker.stickerId);
      }
      return [...(previous ?? []), favoriteFrom(sticker)];
    });
  };

  const undoFavorite = (sticker: StickerChoice, wasStarred: boolean): void => {
    setFavorites((previous) => {
      if (wasStarred) {
        return [...(previous ?? []), favoriteFrom(sticker)];
      }
      return (previous ?? []).filter((row) => row.id !== sticker.stickerId);
    });
    setFavoriteError('Could not save the favorite. Try again.');
  };

  return (
    <div
      role="dialog"
      aria-label="Stickers"
      data-testid="sticker-panel"
      className="fixed right-4 bottom-24 z-20 max-w-[calc(100vw-2rem)] min-w-[min(344px,calc(100vw-2rem))] rounded-[14px] border border-edge bg-surface shadow-lg"
    >
      <div className="border-b border-edge p-2">
        <SegmentedControl
          ariaLabel="Panel tabs"
          options={PANEL_TABS.filter((name) => name !== 'gifs' || gifsEnabled !== false).map(
            (name) => ({
              value: name,
              label: name === 'stickers' ? 'Stickers' : name === 'gifs' ? 'GIFs' : 'Emoji',
            }),
          )}
          value={visibleTab}
          onChange={(next) => {
            const match = PANEL_TABS.find((name) => name === next);
            if (match !== undefined) {
              setTab(match);
            }
          }}
        />
      </div>

      {visibleTab === 'gifs' && gifsEnabled !== false && <GifPanel onPick={onGifPick} />}

      {visibleTab === 'emoji' && <EmojiTab onEmoji={onEmoji} />}

      {visibleTab === 'stickers' && (
        <StickerGrid
          activeStickers={activeStickers}
          favoriteIds={favoriteIds}
          packs={packs}
          activePackId={activePackId}
          onSelectPack={setActivePackId}
          favoriteError={favoriteError}
          onPick={pick}
          onApplyFavorite={applyFavorite}
          onUndoFavorite={undoFavorite}
          onCreate={onCreate}
          onManage={onManage}
          onBrokenRecent={(id) => setRecents(forgetRecentSticker(panelStorage(), id))}
        />
      )}
    </div>
  );
}
