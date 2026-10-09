import { Effect } from 'effect';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Star } from 'lucide-react';
import {
  GifPanel,
  gifsAvailability,
  probeGifsAvailabilityEffect,
  type GifChoice,
} from './GifPanel';
import type { Sticker, StickerPack } from '@/lib/api';
import {
  addStickerFavorite,
  discoverStickerPacks,
  listStickerFavorites,
  listStickerPacks,
  removeStickerFavorite,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { isMockMode } from '@/mock/gate';
import { mockGifItems } from '@/mock/helpers';
import { isPanelStickerUrl, readRecentStickers, rememberRecentSticker } from '@/lib/stickers';
import type { RecentStickerEntry } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';

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
  /** Appends an emoji to the composer draft (the Emoji tab has no server). */
  onEmoji: (emoji: string) => void;
  /** Sends a GIF through the attachment upload path (T-0122). */
  onGifPick: (gif: GifChoice) => void;
  /** Opens Settings → Stickers ("Manage stickers" link in the panel). */
  onManage?: (() => void) | undefined;
  /** Opens the pack creator (the "+" tab in the panel). */
  onCreate?: (() => void) | undefined;
  /**
   * Forces the GIFs tab visible or hidden (T-0146, tests only): the panel
   * otherwise probes the server once per session. Mock mode always shows
   * the tab (placeholders need no server).
   */
  gifsTab?: 'show' | 'hide' | undefined;
}

/**
 * A panel thumbnail: a same-origin sticker file URL loads lazily; anything
 * else (e.g. a hostile URL planted in localStorage recents) shows the
 * emoji tile so the browser never fetches it.
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

/** The recents in localStorage at this sync edge; a blocked or hostile storage gives none. */
function readStoredRecents(): RecentStickerEntry[] {
  return Effect.runSync(
    Effect.try(() => readRecentStickers(window.localStorage)).pipe(
      Effect.orElseSucceed((): RecentStickerEntry[] => []),
    ),
  );
}

/** The page's localStorage for a write, or null when the browser blocks it. */
function panelStorage(): Storage | null {
  return Effect.runSync(
    Effect.try(() => window.localStorage).pipe(Effect.orElseSucceed((): Storage | null => null)),
  );
}

/**
 * The favorite star on one sticker tile (T-0121). It has its own action, so a
 * second click on the same star waits for the first request while other stars
 * run at once. The request is uninterruptible: a row leaves the list at once
 * when its favorite is removed on the Favorites tab, and a failed request must
 * still roll back.
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

type Tab = 'stickers' | 'gifs' | 'emoji';

const PANEL_TABS: readonly Tab[] = ['stickers', 'gifs', 'emoji'] as const;

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
 * The sticker panel in the composer (T-0120, GIFs in T-0122): tabs Stickers /
 * GIFs / Emoji, a strip of pack tabs (first: Recent), a 5-column grid of 56
 * px tiles that fit the 344 px panel with no overlap, hover/keyboard focus
 * preview, click sends. The GIFs tab searches through the
 * privacy-preserving proxy; the Emoji tab appends a common emoji to the
 * draft.
 *
 * The dialog is `fixed` to the viewport's bottom-right (`right-4
 * bottom-24`, next to the composer's emoji button) with
 * `max-w-[calc(100vw-2rem)]`, so it opens above the button and always stays
 * inside the viewport, even on narrow windows.
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
  const [tab, setTab] = useState<Tab>('stickers');
  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [activePackId, setActivePackId] = useState<string | undefined>(undefined);
  const [favorites, setFavorites] = useState<Sticker[] | undefined>(undefined);
  const [favoriteError, setFavoriteError] = useState('');
  const [recents, setRecents] = useState<RecentStickerEntry[]>(readStoredRecents);
  const [preview, setPreview] = useState<StickerChoice | undefined>(undefined);
  // T-0146: the GIFs tab hides when the provider is off. The probe runs
  // once per session and remembers the answer; mock mode keeps the tab
  // (placeholders need no server). Shown/hidden are derived during render
  // from the tri-state; the probe settles into the state below (an
  // external-system sync, like the sticker list load), and a tab that
  // disappears under the active tab falls back to Stickers at render time
  // so the panel never shows an empty body.
  // In the unit-test run (`MODE === 'test'`) and in mock mode the panel
  // uses placeholders, so no probe is needed and the tab always shows.
  // `isMockMode()` is true in tests (MODE=test), which also covers mock.
  // `gifsTab` forces the answer in tests of the hidden state.
  const gifsProbeNeeded = gifsTab === undefined && !isMockMode();
  const [gifsEnabled, setGifsEnabled] = useState<boolean | undefined>(() => {
    if (gifsTab !== undefined) {
      return gifsTab === 'show';
    }
    return isMockMode() ? true : gifsAvailability();
  });

  useQuery(
    () =>
      gifsProbeNeeded
        ? probeGifsAvailabilityEffect().pipe(
            Effect.tap((available) => Effect.sync(() => setGifsEnabled(available))),
          )
        : Effect.void,
    [gifsProbeNeeded],
  );

  // The visible tab: when the GIF tab disappears under the active tab, the
  // panel shows Stickers instead of an empty body.
  const visibleTab: Tab = tab === 'gifs' && gifsEnabled === false ? 'stickers' : tab;

  // A failed list shows no packs; the panel says so instead of loading forever.
  useQuery(
    () =>
      fromApi(() => listStickerPacks()).pipe(
        Effect.tap((loaded) => Effect.sync(() => setPacks(loaded))),
        Effect.catchTag('ApiFailure', () => Effect.sync(() => setPacks([]))),
      ),
    [],
  );

  // Discover is best-effort: server packs are browsable even before T-0121.
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

  // Favorites are best-effort too: the panel works without them.
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
      return (favorites ?? []).map((sticker) => ({
        stickerId: sticker.id,
        packId: sticker.packId,
        url: sticker.url,
        ...(sticker.emoji === null ? {} : { emoji: sticker.emoji }),
        width: sticker.width,
        height: sticker.height,
        mime: sticker.mime,
      }));
    }
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

  // The sticker grid: 5 columns of fixed 56 px square tiles inside a
  // min-344px panel (5 x 56 + 4 x 8 gap + 2 x 8 padding = 328 px, leaving
  // room for the scrollbar), so tiles never overlap. The image stays
  // object-contain inside its tile with breathing room (T-0155: `p-1.5`,
  // so the star's backdrop corner never touches the art) and the star is a
  // small corner button fully inside the tile.
  const TILE_PX = 56;

  // Optimistic favorite: flip the star at once (`wasStarred` is the state
  // before the click).
  const applyFavorite = (sticker: StickerChoice, wasStarred: boolean): void => {
    setFavoriteError('');
    setFavorites((previous) => {
      if (wasStarred) {
        return (previous ?? []).filter((row) => row.id !== sticker.stickerId);
      }
      const added: Sticker = {
        id: sticker.stickerId,
        packId: sticker.packId,
        emoji: sticker.emoji ?? null,
        mime: sticker.mime,
        width: sticker.width,
        height: sticker.height,
        bytes: 0,
        url: sticker.url,
      };
      return [...(previous ?? []), added];
    });
  };

  // Rolls back an optimistic favorite whose request failed.
  const undoFavorite = (sticker: StickerChoice, wasStarred: boolean): void => {
    setFavorites((previous) => {
      if (wasStarred) {
        const restored: Sticker = {
          id: sticker.stickerId,
          packId: sticker.packId,
          emoji: sticker.emoji ?? null,
          mime: sticker.mime,
          width: sticker.width,
          height: sticker.height,
          bytes: 0,
          url: sticker.url,
        };
        return [...(previous ?? []), restored];
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

      {visibleTab === 'gifs' && gifsEnabled !== false && (
        <GifPanel onPick={onGifPick} {...(isMockMode() ? { mockItems: mockGifItems() } : {})} />
      )}

      {visibleTab === 'emoji' && (
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

      {visibleTab === 'stickers' && (
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
            <button
              type="button"
              role="tab"
              aria-selected={activePackId === 'favorites'}
              aria-label="Favorites"
              title="Favorites"
              onClick={() => setActivePackId('favorites')}
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
                      onClick={() => pick(sticker)}
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
                      onApply={applyFavorite}
                      onUndo={undoFavorite}
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
      )}
    </div>
  );
}
