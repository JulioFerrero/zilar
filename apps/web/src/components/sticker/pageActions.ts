import { type Dispatch, type SetStateAction } from 'react';
import { Effect } from 'effect';
import {
  addStickerPanelPack,
  deleteStickerPack,
  discoverStickerPacks,
  listStickerFavorites,
  listStickerPacks,
  patchStickerPack,
  removeStickerFavorite,
  removeStickerPanelPack,
  reorderStickerPanelPacks,
  type Sticker,
  type StickerPack,
} from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { getStickerPack, type StickerPackDetail } from '@/lib/api/stickers';

export type PageStatus = 'loading' | 'ready' | 'error';

export interface PageSetters {
  readonly setPacks: Dispatch<SetStateAction<StickerPack[] | undefined>>;
  readonly setFavorites: Dispatch<SetStateAction<Sticker[] | undefined>>;
  readonly setDiscover: Dispatch<SetStateAction<StickerPack[] | undefined>>;
  readonly setActionError: Dispatch<SetStateAction<string>>;
}

/**
 * A call that never got an answer shows the component's fixed sentence (a
 * user-facing error is never raw server text); an answer shows the server's.
 */
export function failureText(failure: ApiFailure, fallback: string): string {
  return failure.status === 0 ? fallback : failure.message;
}

export function stickerPackUrl(packId: string): string {
  return `${window.location.origin}/stickers/${encodeURIComponent(packId)}`;
}

export function stickerPackUrlText(packId: string): string {
  return `${window.location.host}/stickers/${packId}`;
}

export const loadPanel = (
  setters: Pick<PageSetters, 'setPacks' | 'setFavorites'>,
): Effect.Effect<void, ApiFailure> =>
  Effect.all([fromApi(() => listStickerPacks()), fromApi(() => listStickerFavorites())], {
    concurrency: 'unbounded',
  }).pipe(
    Effect.tap(([panel, starred]) =>
      Effect.sync(() => {
        setters.setPacks(panel);
        setters.setFavorites(starred);
      }),
    ),
    Effect.asVoid,
  );

export const refreshPanel = (setters: PageSetters): Effect.Effect<void> =>
  fromApi(() => listStickerPacks()).pipe(
    Effect.tap((panel) => Effect.sync(() => setters.setPacks(panel))),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not refresh packs'))),
    ),
  );

export const searchPacks = (query: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => discoverStickerPacks(query))),
    Effect.tap((page) => Effect.sync(() => setters.setDiscover(page.packs))),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not search packs'))),
    ),
  );

export const toggleVisibility = (pack: StickerPack, setters: PageSetters): Effect.Effect<void> => {
  // Imported packs stay private (personal use): the server refuses the switch,
  // but the button hides up front so the offer is never made.
  if (pack.importedFrom !== undefined && pack.visibility !== 'server') {
    return Effect.sync(() =>
      setters.setActionError('Imported packs stay private for personal use.'),
    );
  }
  return Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(
      fromApi(() =>
        patchStickerPack(pack.id, {
          visibility: pack.visibility === 'server' ? 'private' : 'server',
        }),
      ),
    ),
    Effect.tap((updated) =>
      Effect.sync(() =>
        setters.setPacks((previous) =>
          previous?.map((row) => (row.id === pack.id ? updated : row)),
        ),
      ),
    ),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() =>
        setters.setActionError(
          failure.code === 'imported_private'
            ? 'Imported packs stay private for personal use.'
            : failureText(failure, 'Could not change the visibility'),
        ),
      ),
    ),
  );
};

export const addToPanel = (packId: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => addStickerPanelPack(packId))),
    Effect.andThen(refreshPanel(setters)),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not add the pack'))),
    ),
  );

export const removeFromPanel = (packId: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => removeStickerPanelPack(packId))),
    Effect.andThen(refreshPanel(setters)),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not remove the pack'))),
    ),
  );

export const loadPackDetail = (packId: string): Effect.Effect<StickerPackDetail, ApiFailure> =>
  fromApi(() => getStickerPack(packId));

export const addPackToPanel = (packId: string): Effect.Effect<void, ApiFailure> =>
  fromApi(() => addStickerPanelPack(packId));

export const removePackFromPanel = (packId: string): Effect.Effect<void, ApiFailure> =>
  fromApi(() => removeStickerPanelPack(packId));

export const deletePack = (packId: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => deleteStickerPack(packId))),
    Effect.tap(() =>
      Effect.sync(() =>
        setters.setPacks((previous) => previous?.filter((row) => row.id !== packId)),
      ),
    ),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not delete the pack'))),
    ),
  );

export const unstarSticker = (stickerId: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => removeStickerFavorite(stickerId))),
    Effect.tap(() =>
      Effect.sync(() =>
        setters.setFavorites((previous) => previous?.filter((row) => row.id !== stickerId)),
      ),
    ),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() =>
        setters.setActionError(failureText(failure, 'Could not remove the favorite')),
      ),
    ),
  );

// Moving a pack sends the whole new order to the atomic reorder endpoint, so
// a failure leaves the server order untouched (the UI then restores it too).
const reorderPanel = (
  next: StickerPack[],
  previous: StickerPack[],
  setters: PageSetters,
): Effect.Effect<void> =>
  Effect.sync(() => {
    setters.setActionError('');
    setters.setPacks(next);
  }).pipe(
    Effect.andThen(fromApi(() => reorderStickerPanelPacks(next.map((pack) => pack.id)))),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => {
        setters.setPacks(previous);
        setters.setActionError(failureText(failure, 'Could not reorder packs'));
      }),
    ),
  );

export const dragPack = (
  ordered: StickerPack[],
  activeId: string,
  overId: string,
  setters: PageSetters,
): Effect.Effect<void> => {
  if (activeId === overId) {
    return Effect.void;
  }
  const from = ordered.findIndex((pack) => pack.id === activeId);
  const to = ordered.findIndex((pack) => pack.id === overId);
  if (from < 0 || to < 0) {
    return Effect.void;
  }
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return Effect.void;
  }
  next.splice(to, 0, moved);
  return reorderPanel(next, ordered, setters);
};
