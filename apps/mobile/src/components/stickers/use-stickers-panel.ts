import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Effect, Fiber } from 'effect';

import { useAuthStore } from '@/auth/session';
import { fromApi } from '@/lib/effect/api-effect';
import { getSessionToken } from '@/lib/session-token';
import type { StickerItem, StickerPack } from '@/lib/stickers';
import { movedOrder, panelIdSet } from '@/components/stickers/order';
import { favoriteTileSize } from '@/components/stickers/tile-size';
import { useStickersApi } from '@/components/stickers/use-stickers-api';

export type StickerTab = 'packs' | 'discover' | 'favorites';

type PageStatus = 'loading' | 'ready' | 'error';

export const DISCOVER_ERROR = 'Could not load shared packs.';
const ADD_ERROR = 'Could not add the pack. Try again.';
const REMOVE_MODAL_ERROR = 'Could not remove the pack. Try again.';
const REORDER_ERROR = 'Could not reorder your packs. Try again.';
const FAVORITE_ERROR = 'Could not remove the favorite. Try again.';

/**
 * The panel state and actions behind Settings → Stickers (T-0187, split out
 * in T-0996): the pack list, the Discover search and the favorites, plus the
 * reload, reorder, add, remove and unfavorite requests.
 */
export function useStickersPanel() {
  const { width: windowWidth } = useWindowDimensions();
  const { api } = useStickersApi();

  const [tab, setTab] = useState<StickerTab>('packs');
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [favorites, setFavorites] = useState<StickerItem[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [discover, setDiscover] = useState<StickerPack[] | undefined>(undefined);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guards against a double tap landing before React re-renders the
  // disabled button, so one tap can never send two requests (machines.tsx).
  const busyRef = useRef(false);
  const [confirming, setConfirming] = useState<StickerPack | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  // Remounts the import sheet on every open so earlier input, result and
  // error clear (brief §1).
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
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setActionError('');
    Effect.runFork(
      Effect.all(
        [fromApi(() => api.listStickerPacks()), fromApi(() => api.listStickerFavorites())],
        {
          concurrency: 'unbounded',
        },
      ).pipe(
        Effect.tap(([panel, starred]) =>
          Effect.sync(() => {
            setPacks(panel);
            setFavorites(starred);
            setStatus('ready');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setStatus('error');
          }),
        ),
      ),
    );
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

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
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusyId(null);
          }),
        ),
      ),
    );
  };

  const refreshPanel = fromApi(() => api.listStickerPacks()).pipe(
    Effect.tap((panel) =>
      Effect.sync(() => {
        setPacks(panel);
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
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusyId(null);
          }),
        ),
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
    setPacks(next.map((id) => byId.get(id)).filter((pack) => pack !== undefined));
    Effect.runFork(
      fromApi(() => api.reorderStickerPanelPacks(next)).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            setPacks(previous);
            setActionError(REORDER_ERROR);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusyId(null);
          }),
        ),
      ),
    );
  };

  const unstar = (stickerId: string): void => {
    run(
      stickerId,
      fromApi(() => api.removeStickerFavorite(stickerId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setFavorites((previous) => previous.filter((row) => row.id !== stickerId));
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
    meId: me?.id,
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
