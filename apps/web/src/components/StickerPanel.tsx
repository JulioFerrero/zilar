import { Effect } from 'effect';
import { useEffect, useMemo, useState } from 'react';
import {
  GifPanel,
  gifsAvailability,
  probeGifsAvailabilityEffect,
  type GifChoice,
} from './GifPanel';
import type { Sticker, StickerPack } from '@/lib/api';
import { discoverStickerPacks, listStickerFavorites, listStickerPacks } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useQuery } from '@/lib/effect/use-query';
import { isMockMode } from '@/mock/gate';
import { mockGifItems } from '@/mock/helpers';
import { rememberRecentSticker } from '@/lib/stickers';
import type { RecentStickerEntry } from '@/lib/stickers';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { COMMON_EMOJI } from './sticker/emoji';
import { StickerGrid } from './sticker/StickerGrid';
import { panelStorage, readStoredRecents } from './sticker/StickerThumb';

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

type Tab = 'stickers' | 'gifs' | 'emoji';

const PANEL_TABS: readonly Tab[] = ['stickers', 'gifs', 'emoji'] as const;

/** One row from a pack, a favorite or the recents, normalised to a panel choice. */
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

/** The panel choice as a favorite row, for the optimistic add and its rollback. */
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
/**
 * The mock GIF placeholders, only in a build that can run mock mode. The
 * build-time condition is inline so Vite folds `mockGifItems` (and
 * mock/helpers) out of a production build without `VITE_MOCK` (T-0882).
 */
function mockGifProps(): { mockItems?: ReturnType<typeof mockGifItems> } {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_MOCK === '1') {
    return isMockMode() ? { mockItems: mockGifItems() } : {};
  }
  return {};
}

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

  // Optimistic favorite: flip the star at once (`wasStarred` is the state
  // before the click).
  const applyFavorite = (sticker: StickerChoice, wasStarred: boolean): void => {
    setFavoriteError('');
    setFavorites((previous) => {
      if (wasStarred) {
        return (previous ?? []).filter((row) => row.id !== sticker.stickerId);
      }
      return [...(previous ?? []), favoriteFrom(sticker)];
    });
  };

  // Rolls back an optimistic favorite whose request failed.
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

      {visibleTab === 'gifs' && gifsEnabled !== false && (
        <GifPanel onPick={onGifPick} {...mockGifProps()} />
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
        />
      )}
    </div>
  );
}
