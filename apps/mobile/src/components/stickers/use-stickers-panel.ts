import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Effect } from 'effect';

import { useAuthStore } from '@/auth/session';
import { useFocusList } from '@/components/settings/use-focus-list';
import { fromApi, interruptFiber } from '@zilar/client-core';
import { getSessionToken } from '@/lib/session-token';
import type { StickerItem, StickerPack } from '@/lib/stickers';
import { favoriteTileSize } from '@/components/stickers/tile-size';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import type { PanelPack } from '@zilar/client-core';

/**
 * Pure helpers for the sticker screen: the reorder arithmetic and the panel
 * membership set, covered by Vitest without a simulator.
 */

function movedOrder(ids: readonly string[], packId: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(packId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as string);
  return next;
}

function panelIdSet(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

export type StickerTab = 'packs' | 'discover' | 'favorites';

type PanelData = {
  readonly packs: StickerPack[];
  readonly favorites: StickerItem[];
};

export const DISCOVER_ERROR = 'Could not load shared packs.';
const ADD_ERROR = 'Could not add the pack. Try again.';
const REMOVE_MODAL_ERROR = 'Could not remove the pack. Try again.';
const REORDER_ERROR = 'Could not reorder your packs. Try again.';
const FAVORITE_ERROR = 'Could not remove the favorite. Try again.';

export function useStickersPanel() {
  const { width: windowWidth } = useWindowDimensions();
  const { api, viewerId } = useStickersApi();

  const [tab, setTab] = useState<StickerTab>('packs');
  const [discover, setDiscover] = useState<PanelPack[] | undefined>(undefined);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guards a double tap landing before React re-renders the disabled button.
  const busyRef = useRef(false);
  const [confirming, setConfirming] = useState<StickerPack | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importNonce, setImportNonce] = useState(0);
  const [token, setToken] = useState<string | undefined>(undefined);
  const me = useAuthStore((state) => state.me);
  const discoverLoaded = useRef(false);

  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.promise(() => getSessionToken()).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            setToken(value);
          }),
        ),
      ),
    );
    return () => {
      interruptFiber(fiber);
    };
  }, []);

  // A reload over shown data keeps it, so returning never flashes the loading
  // state; a failed reload also keeps the list instead of blanking it.
  const { data, setData, status, reload } = useFocusList<PanelData, unknown>(() =>
    Effect.sync(() => setActionError('')).pipe(
      Effect.andThen(
        Effect.all(
          [fromApi(() => api.listStickerPacks()), fromApi(() => api.listStickerFavorites())],
          {
            concurrency: 'unbounded',
          },
        ),
      ),
      Effect.map(([packs, favorites]) => ({ packs, favorites })),
    ),
  );
  const packs = data?.packs ?? [];
  const favorites = data?.favorites ?? [];

  const loadDiscover = useCallback(
    (search: string) => {
      setDiscoverBusy(true);
      setDiscoverError('');
      Effect.runFork(
        fromApi(() => api.discoverStickerPacks(search)).pipe(
          Effect.tap((page) =>
            Effect.sync(() => {
              setDiscover(page.packs);
              discoverLoaded.current = true;
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              setDiscoverError(DISCOVER_ERROR);
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              setDiscoverBusy(false);
            }),
          ),
        ),
      );
    },
    [api],
  );

  const openTab = (next: StickerTab): void => {
    setTab(next);
    if (next === 'discover' && !discoverLoaded.current && !discoverBusy) {
      loadDiscover('');
    }
  };

  const releaseBusy = (): Effect.Effect<void> =>
    Effect.sync(() => {
      busyRef.current = false;
      setBusyId(null);
    });

  const run = (id: string, task: Effect.Effect<unknown, unknown>, fallback: string): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyId(id);
    setActionError('');
    Effect.runFork(
      task.pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            setActionError(fallback);
          }),
        ),
        Effect.ensuring(releaseBusy()),
      ),
    );
  };

  const refreshPanel = fromApi(() => api.listStickerPacks()).pipe(
    Effect.tap((panel) =>
      Effect.sync(() => {
        setData((current) =>
          current === undefined ? { packs: panel, favorites: [] } : { ...current, packs: panel },
        );
      }),
    ),
  );

  const addPack = (packId: string): void => {
    run(
      packId,
      fromApi(() => api.addStickerPanelPack(packId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setDiscover((previous) =>
              previous === undefined ? previous : previous.map((row) => ({ ...row })),
            );
          }),
        ),
        Effect.andThen(refreshPanel),
      ),
      ADD_ERROR,
    );
  };

  const askRemove = (pack: StickerPack): void => {
    setConfirming(pack);
    setConfirmError('');
  };

  const confirmRemove = (): void => {
    if (confirming === null || busyRef.current) {
      return;
    }
    const packId = confirming.id;
    busyRef.current = true;
    setBusyId(packId);
    setConfirmError('');
    Effect.runFork(
      fromApi(() => api.removeStickerPanelPack(packId)).pipe(
        Effect.andThen(refreshPanel),
        Effect.andThen(
          Effect.sync(() => {
            setConfirming(null);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setConfirmError(REMOVE_MODAL_ERROR);
          }),
        ),
        Effect.ensuring(releaseBusy()),
      ),
    );
  };

  const movePack = (packId: string, direction: -1 | 1): void => {
    if (busyRef.current) {
      return;
    }
    const ids = packs.map((pack) => pack.id);
    const next = movedOrder(ids, packId, direction);
    if (next.join() === ids.join()) {
      return;
    }
    busyRef.current = true;
    setBusyId(packId);
    setActionError('');
    const previous = packs;
    const byId = new Map(packs.map((pack) => [pack.id, pack]));
    setData((current) =>
      current === undefined
        ? current
        : {
            ...current,
            packs: next.map((id) => byId.get(id)).filter((pack) => pack !== undefined),
          },
    );
    Effect.runFork(
      fromApi(() => api.reorderStickerPanelPacks(next)).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            setData((current) =>
              current === undefined ? current : { ...current, packs: previous },
            );
            setActionError(REORDER_ERROR);
          }),
        ),
        Effect.ensuring(releaseBusy()),
      ),
    );
  };

  const unstar = (stickerId: string): void => {
    run(
      stickerId,
      fromApi(() => api.removeStickerFavorite(stickerId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setData((current) =>
              current === undefined
                ? current
                : {
                    ...current,
                    favorites: current.favorites.filter((row) => row.id !== stickerId),
                  },
            );
          }),
        ),
      ),
      FAVORITE_ERROR,
    );
  };

  const openImport = (): void => {
    setImportNonce((nonce) => nonce + 1);
    setImportOpen(true);
  };

  const busy = busyId !== null;
  const panelIds = panelIdSet(packs.map((pack) => pack.id));
  const tile = favoriteTileSize(windowWidth);

  return {
    api,
    tab,
    openTab,
    packs,
    favorites,
    status,
    actionError,
    discover,
    discoverBusy,
    discoverError,
    query,
    setQuery,
    busy,
    busyId,
    confirming,
    setConfirming,
    confirmError,
    confirmRemove,
    importOpen,
    setImportOpen,
    importNonce,
    openImport,
    token,
    meId: viewerId ?? me?.id,
    reload,
    loadDiscover,
    addPack,
    askRemove,
    movePack,
    unstar,
    panelIds,
    tile,
  };
}
