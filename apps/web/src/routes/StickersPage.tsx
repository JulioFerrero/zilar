import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
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
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { type Sticker, type StickerPack } from '@/lib/api';
import {
  type MoveRequest,
  type PageSetters,
  type PageStatus,
  failureText,
  loadDiscover,
  loadPanel,
  movePack,
  refreshPanel,
  searchPacks,
} from '@/components/sticker/pageActions';
import { AddedPackRow, DiscoverPackRow, MyPackRow } from '@/components/sticker/PackRows';
import { FavoriteRow } from '@/components/sticker/FavoriteRow';

/**
 * Settings → Stickers (T-0121): my packs, packs I added, discover with
 * search, favorites, and the pack creator/editor.
 */

// The column comes from the shared shell (T-0153); the local constant stays
// re-exported so existing imports keep working.
export { SETTINGS_COLUMN };
export type { PackRowThumb } from '@/components/sticker/PackThumbs';

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
