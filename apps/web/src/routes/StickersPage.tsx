import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronUp, Star } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useAuth } from '@/auth/AuthProvider';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PackEditor } from '@/components/PackEditor';
import { TelegramImportDialog } from '@/components/TelegramImportDialog';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { SearchField } from '@/components/ui/search-field';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
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

type PageStatus = 'loading' | 'ready' | 'error';

/** The page state the actions write to: the lists and the one message line. */
interface PageSetters {
  readonly setPacks: Dispatch<SetStateAction<StickerPack[] | undefined>>;
  readonly setFavorites: Dispatch<SetStateAction<Sticker[] | undefined>>;
  readonly setDiscover: Dispatch<SetStateAction<StickerPack[] | undefined>>;
  readonly setActionError: Dispatch<SetStateAction<string>>;
}

interface MoveRequest {
  readonly packId: string;
  readonly direction: -1 | 1;
}

/**
 * The text a failed call shows. A call that never got an answer shows the
 * component's fixed sentence (AGENTS.md); an answer shows the server's sentence.
 */
function failureText(failure: ApiFailure, fallback: string): string {
  return failure.status === 0 ? fallback : failure.message;
}

/** Loads the panel and the favorites; both must answer, or the page shows the error. */
const loadPanel = (
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

/** Discover on first paint is best-effort: a failure leaves the section loading. */
const loadDiscover = (setters: Pick<PageSetters, 'setDiscover'>): Effect.Effect<void, ApiFailure> =>
  fromApi(() => discoverStickerPacks()).pipe(
    Effect.tap((page) => Effect.sync(() => setters.setDiscover(page.packs))),
    Effect.asVoid,
  );

/** Reads the panel list again. A failed read reports on the message line and keeps the list. */
const refreshPanel = (setters: PageSetters): Effect.Effect<void> =>
  fromApi(() => listStickerPacks()).pipe(
    Effect.tap((panel) => Effect.sync(() => setters.setPacks(panel))),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not refresh packs'))),
    ),
  );

const searchPacks = (query: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => discoverStickerPacks(query))),
    Effect.tap((page) => Effect.sync(() => setters.setDiscover(page.packs))),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not search packs'))),
    ),
  );

const toggleVisibility = (pack: StickerPack, setters: PageSetters): Effect.Effect<void> => {
  // Imported packs stay private (personal use): the server refuses the
  // switch, but the button hides up front so the offer is never made.
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

const addToPanel = (packId: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => addStickerPanelPack(packId))),
    Effect.andThen(refreshPanel(setters)),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not add the pack'))),
    ),
  );

const removeFromPanel = (packId: string, setters: PageSetters): Effect.Effect<void> =>
  Effect.sync(() => setters.setActionError('')).pipe(
    Effect.andThen(fromApi(() => removeStickerPanelPack(packId))),
    Effect.andThen(refreshPanel(setters)),
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() => setters.setActionError(failureText(failure, 'Could not remove the pack'))),
    ),
  );

const deletePack = (packId: string, setters: PageSetters): Effect.Effect<void> =>
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

const unstarSticker = (stickerId: string, setters: PageSetters): Effect.Effect<void> =>
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

// Panel order is the panel list order; moving a pack sends the whole
// new order to the atomic reorder endpoint, so a failure leaves the
// server order untouched (the UI then restores it too).
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

const movePack = (
  ordered: StickerPack[],
  { packId, direction }: MoveRequest,
  setters: PageSetters,
): Effect.Effect<void> => {
  const index = ordered.findIndex((pack) => pack.id === packId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) {
    return Effect.void;
  }
  const next = [...ordered];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return reorderPanel(next, ordered, setters);
};

export interface PackRowThumb {
  url: string;
  alt: string;
}

/** A pack row's thumbnail strip: the first few sticker images, side by side. */
function PackThumbs({ thumbs }: { thumbs: PackRowThumb[] }) {
  if (thumbs.length === 0) {
    return (
      <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-surface-raised text-[20px]">
        🙂
      </span>
    );
  }
  return (
    <span className="flex shrink-0 -space-x-3">
      {thumbs.map((thumb, index) => (
        <img
          key={`${index}-${thumb.url}`}
          src={thumb.url}
          alt={thumb.alt}
          loading="lazy"
          width={56}
          height={56}
          className="size-14 rounded-[10px] border border-edge bg-surface object-contain"
        />
      ))}
    </span>
  );
}

function thumbsOf(pack: StickerPack): PackRowThumb[] {
  return pack.stickers.slice(0, 5).map((sticker, index) => ({
    url: sticker.url,
    alt: sticker.emoji ?? `Sticker ${index + 1}`,
  }));
}

type VisibilityBadge = 'Shared' | 'Private';

function VisibilityBadge({ label }: { label: VisibilityBadge }) {
  return (
    <span
      className={
        label === 'Shared'
          ? 'rounded-full bg-accent px-2 py-0.5 text-[12px] font-medium text-accent-foreground'
          : 'rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground'
      }
    >
      {label}
    </span>
  );
}

/**
 * A pack I own. Each button has its own action, so two rows (or two buttons)
 * can run at once, while a double click on the same button sends once.
 */
function MyPackRow({
  pack,
  moving,
  setters,
  onMove,
  onEdit,
  onDelete,
  registerDelete,
}: {
  pack: StickerPack;
  moving: boolean;
  setters: PageSetters;
  onMove: (packId: string, direction: -1 | 1) => void;
  onEdit: (packId: string) => void;
  onDelete: (pack: StickerPack) => void;
  registerDelete: (packId: string, run: () => void) => () => void;
}) {
  const [, runVisibility] = useAction<void, void, never>(() => toggleVisibility(pack, setters));
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  const [, runDelete] = useAction<void, void, never>(() => deletePack(pack.id, setters));
  // The page-level confirm dialog calls this row's own delete action.
  useEffect(() => registerDelete(pack.id, () => runDelete()), [pack.id, registerDelete, runDelete]);
  const importedShareLocked = pack.importedFrom !== undefined;
  const shareReasonId = `share-reason-${pack.id}`;
  const shareButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => runVisibility()}
      disabled={importedShareLocked}
      aria-describedby={importedShareLocked ? shareReasonId : undefined}
    >
      {pack.visibility === 'server' ? 'Make private' : 'Share'}
    </Button>
  );
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <PackThumbs thumbs={thumbsOf(pack)} />
      <span className="min-w-0 flex-1 basis-40">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-medium">{pack.title}</span>
          <VisibilityBadge
            label={
              pack.importedFrom !== undefined || pack.visibility !== 'server' ? 'Private' : 'Shared'
            }
          />
        </span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {pack.stickers.length} sticker{pack.stickers.length === 1 ? '' : 's'}
          {pack.importedFrom !== undefined ? ' · Imported from Telegram' : ''}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${pack.title} up`}
          title={`Move ${pack.title} up`}
          disabled={moving}
          onClick={() => onMove(pack.id, -1)}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${pack.title} down`}
          title={`Move ${pack.title} down`}
          disabled={moving}
          onClick={() => onMove(pack.id, 1)}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
        {importedShareLocked ? (
          <span title="Imported packs stay private for personal use" className="inline-flex">
            {shareButton}
            <span id={shareReasonId} className="sr-only">
              Imported packs stay private for personal use
            </span>
          </span>
        ) : (
          shareButton
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(pack.id)}>
          Edit
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runRemove()}>
          Remove from panel
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(pack)}>
          Delete
        </Button>
      </span>
    </li>
  );
}

/** A pack someone else owns that I added to my panel. */
function AddedPackRow({ pack, setters }: { pack: StickerPack; setters: PageSetters }) {
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <PackThumbs thumbs={thumbsOf(pack)} />
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[15px] font-medium">{pack.title}</span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {pack.stickers.length} sticker{pack.stickers.length === 1 ? '' : 's'}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => runRemove()}
      >
        Remove
      </Button>
    </li>
  );
}

/** A shared pack from the discover search, with its own Add or Remove action. */
function DiscoverPackRow({
  pack,
  added,
  setters,
}: {
  pack: StickerPack;
  added: boolean;
  setters: PageSetters;
}) {
  const [, runAdd] = useAction<void, void, never>(() => addToPanel(pack.id, setters));
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <PackThumbs thumbs={thumbsOf(pack)} />
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[15px] font-medium">{pack.title}</span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {pack.stickers.length} sticker{pack.stickers.length === 1 ? '' : 's'}
        </span>
      </span>
      {added ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => runRemove()}
        >
          Remove
        </Button>
      ) : (
        <Button type="button" size="sm" className="shrink-0" onClick={() => runAdd()}>
          Add
        </Button>
      )}
    </li>
  );
}

/** One favorite sticker with its own Unfavorite action. */
function FavoriteRow({ sticker, setters }: { sticker: Sticker; setters: PageSetters }) {
  const [, runUnstar] = useAction<void, void, never>(() => unstarSticker(sticker.id, setters));
  return (
    <li className="relative flex size-20 items-center justify-center justify-self-center overflow-hidden rounded-[10px] border border-border bg-surface p-1">
      <img
        src={sticker.url}
        alt={sticker.emoji ?? 'Sticker'}
        loading="lazy"
        width={72}
        height={72}
        className="max-h-full max-w-full object-contain"
      />
      <button
        type="button"
        aria-label={`Unfavorite ${sticker.emoji ?? 'sticker'}`}
        title={`Unfavorite ${sticker.emoji ?? 'sticker'}`}
        onClick={() => runUnstar()}
        className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-edge bg-black/70 text-[10px] leading-none text-white"
      >
        <Star className="size-3 fill-current" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * Settings → Stickers (T-0121): my packs, packs I added, discover with
 * search, favorites, and the pack creator/editor.
 */

// The column comes from the shared shell (T-0153); the local constant stays
// re-exported so existing imports keep working.
export { SETTINGS_COLUMN };

export function StickersPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId =
    auth.status === 'authenticated' && auth.user !== undefined ? auth.user.id : undefined;

  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [favorites, setFavorites] = useState<Sticker[] | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [discover, setDiscover] = useState<StickerPack[] | undefined>(undefined);
  const [actionError, setActionError] = useState('');
  const [editingPackId, setEditingPackId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  // One delete dialog for the page. Each row registers its own delete action
  // here, so two packs can be deleted at once and a double click is ignored.
  const [deletingPack, setDeletingPack] = useState<StickerPack | undefined>(undefined);
  const deleteRunners = useRef(new Map<string, () => void>());
  const registerDelete = useCallback((packId: string, run: () => void) => {
    deleteRunners.current.set(packId, run);
    return () => {
      deleteRunners.current.delete(packId);
    };
  }, []);
  const confirmDelete = (): void => {
    if (deletingPack === undefined) {
      return;
    }
    const packId = deletingPack.id;
    setDeletingPack(undefined);
    deleteRunners.current.get(packId)?.();
  };
  // Telegram import (T-0123, T-0162): the dialog opens from "My packs" and
  // always stays visible. A 501 only disables the button's usual flow (the
  // server has no token); the dialog itself shows why. The shared owner
  // hook decides whether the dialog links the settings page — it starts as
  // not-owner, so the link never flashes for a non-owner.
  const [importing, setImporting] = useState(false);
  const isServerOwner = useIsServerOwner();
  const setters: PageSetters = { setPacks, setFavorites, setDiscover, setActionError };

  // The first load (and the retry): both lists must answer.
  const [loadState, reloadPage] = useQuery(() => loadPanel(setters), []);
  const [discoverOnMount] = useQuery(() => loadDiscover(setters), []);
  const [searchState, runSearch] = useAction<void, void, never>(() => searchPacks(query, setters));
  const [, runRefresh] = useAction<void, void, never>(() => refreshPanel(setters), {
    mode: 'replace',
  });
  // Moves are disabled while one runs, so the page-level action never drops a click.
  const [moveState, runMove] = useAction<MoveRequest, void, never>((request) =>
    movePack(packs ?? [], request, setters),
  );

  const loadFailure = isWaiting(loadState) ? undefined : failureOf(loadState);
  const status: PageStatus = AsyncResult.isSuccess(loadState)
    ? 'ready'
    : loadFailure !== undefined
      ? 'error'
      : 'loading';
  const loadError =
    loadFailure !== undefined ? failureText(loadFailure, 'Could not load stickers') : '';
  const discoverBusy = isWaiting(discoverOnMount) || isWaiting(searchState);
  const moving = isWaiting(moveState);

  const myPacks = (packs ?? []).filter((pack) => userId !== undefined && pack.ownerId === userId);
  const addedPacks = (packs ?? []).filter(
    (pack) => userId === undefined || pack.ownerId !== userId,
  );
  const panelIds = new Set((packs ?? []).map((pack) => pack.id));

  if (editingPackId !== undefined) {
    const pack = packs?.find((row) => row.id === editingPackId);
    return (
      <SettingsShell
        title="Edit sticker pack"
        subtitle="Change the title and stickers."
        onBack={() => setEditingPackId(undefined)}
      >
        <div className={SETTINGS_COLUMN}>
          <PackEditor
            packId={editingPackId}
            initialTitle={pack?.title ?? ''}
            initialVisibility={pack?.visibility ?? 'private'}
            initialStickers={pack?.stickers ?? []}
            onDone={() => {
              setEditingPackId(undefined);
              runRefresh();
            }}
            onCancel={() => setEditingPackId(undefined)}
          />
        </div>
      </SettingsShell>
    );
  }

  if (creating) {
    return (
      <SettingsShell
        title="New sticker pack"
        subtitle="Give it a title, then add stickers."
        onBack={() => setCreating(false)}
      >
        <div className={SETTINGS_COLUMN}>
          <PackEditor
            onDone={() => {
              setCreating(false);
              runRefresh();
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="Stickers"
      subtitle="Make packs from your images, share them, and star favorites."
      onBack={() => navigate('/')}
    >
      {status === 'loading' && <StateMessage kind="loading" title="Loading…" />}

      {status === 'error' && (
        <StateMessage
          kind="error"
          title={loadError}
          action={{ label: 'Retry', onClick: () => reloadPage() }}
        />
      )}

      {status === 'ready' && (
        <div className={SETTINGS_COLUMN}>
          {actionError !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {actionError}
            </p>
          )}

          <section aria-label="My packs" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold">My packs</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => setImporting(true)}
                >
                  Import from Telegram
                </Button>
                <Button type="button" size="default" onClick={() => setCreating(true)}>
                  Create pack
                </Button>
              </div>
            </div>
            {myPacks.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                No packs yet. Make one from your photos with Create pack, or import one from
                Telegram.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {myPacks.map((pack) => (
                  <MyPackRow
                    key={pack.id}
                    pack={pack}
                    moving={moving}
                    setters={setters}
                    onMove={(packId, direction) => runMove({ packId, direction })}
                    onEdit={(packId) => setEditingPackId(packId)}
                    onDelete={(target) => setDeletingPack(target)}
                    registerDelete={registerDelete}
                  />
                ))}
              </ul>
            )}
          </section>

          {addedPacks.length > 0 && (
            <section aria-label="Packs I added" className="flex flex-col gap-2">
              <h2 className="text-[16px] font-semibold">Packs I added</h2>
              <ul className="flex flex-col gap-2">
                {addedPacks.map((pack) => (
                  <AddedPackRow key={pack.id} pack={pack} setters={setters} />
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Discover" className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">Discover</h2>
            <p className="text-[14px] text-muted-foreground">
              Find shared packs from anyone on this server and add them to your panel.
            </p>
            <form
              className="mb-1 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                runSearch();
              }}
            >
              <SearchField
                value={query}
                aria-label="Search sticker packs"
                placeholder="Search shared packs"
                maxLength={60}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1"
              />
              <Button type="submit" size="lg" disabled={discoverBusy}>
                Search
              </Button>
            </form>
            {discover === undefined ? (
              <StateMessage kind="loading" size="inline" title="Loading…" />
            ) : discover.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                No shared packs found. Try another search, or make your own with Create pack.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {discover.map((pack) => (
                  <DiscoverPackRow
                    key={pack.id}
                    pack={pack}
                    added={panelIds.has(pack.id)}
                    setters={setters}
                  />
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Favorites" className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold">Favorites</h2>
            {favorites === undefined ? (
              <StateMessage kind="loading" size="inline" title="Loading…" />
            ) : favorites.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                No favorites yet. Open the sticker panel in any chat and tap the star on a sticker
                to keep it here.
              </p>
            ) : (
              <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Favorite stickers">
                {favorites.map((sticker) => (
                  <FavoriteRow key={sticker.id} sticker={sticker} setters={setters} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {deletingPack !== undefined && (
        <ConfirmDialog
          title={`Delete “${deletingPack.title}”?`}
          body="Stickers already sent may stop loading."
          confirmLabel="Delete"
          onConfirm={() => confirmDelete()}
          onCancel={() => setDeletingPack(undefined)}
        />
      )}

      {importing && (
        <TelegramImportDialog
          onDone={() => {
            runRefresh();
          }}
          onClose={() => setImporting(false)}
          onUnavailable={() => {
            // The dialog shows the not-set-up state itself; nothing to
            // hide here. Kept so the entry point learns the feature is
            // off without closing anything.
          }}
          isOwner={isServerOwner}
        />
      )}
    </SettingsShell>
  );
}
