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
import { forgetRecentSticker, rememberRecentSticker } from '@/lib/stickers';
import type { RecentStickerEntry } from '@/lib/stickers';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmojiTab } from './sticker/EmojiTab';
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
  onEmoji: (emoji: string) => void;
  onGifPick: (gif: GifChoice) => void;
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
        ? probeGifsAvailabilityEffect().pipe(
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
