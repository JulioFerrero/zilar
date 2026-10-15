import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Plus, Upload } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PackEditor } from '@/components/PackEditor';
import { TelegramImportDialog } from '@/components/TelegramImportDialog';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { SearchField } from '@/components/ui/search-field';
import { SortableList } from '@/components/ui/sortable-list';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { type Sticker, type StickerPack } from '@/lib/api';
import {
  type PageSetters,
  type PageStatus,
  dragPack,
  failureText,
  loadPanel,
  refreshPanel,
  searchPacks,
} from '@/components/sticker/pageActions';
import { AddedPackRow, DiscoverPackRow, MyPackRow } from '@/components/sticker/PackRows';
import { FavoriteRow } from '@/components/sticker/FavoriteRow';

/**
 * Settings → Stickers (T-0121, T-1523): three tabs — my packs (drag to
 * reorder), discover (search as you type) and favorites — plus the pack
 * creator/editor.
 */

// The column comes from the shared shell (T-0153); the local constant stays
// re-exported so existing imports keep working.
export { SETTINGS_COLUMN };
export type { PackRowThumb } from '@/components/sticker/PackThumbs';

const DISCOVER_SEARCH_DEBOUNCE_MS = 300;

const TABS = [
  { value: 'mine', label: 'My packs' },
  { value: 'discover', label: 'Discover' },
  { value: 'favorites', label: 'Favorites' },
];

export function StickersPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId =
    auth.status === 'authenticated' && auth.user !== undefined ? auth.user.id : undefined;

  const [tab, setTab] = useState<string>('mine');
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
  // Telegram import (T-0123, T-0162): the dialog opens from the header and
  // always stays visible. A 501 only disables the button's usual flow (the
  // server has no token); the dialog itself shows why. The shared owner
  // hook decides whether the dialog links the settings page — it starts as
  // not-owner, so the link never flashes for a non-owner.
  const [importing, setImporting] = useState(false);
  const isServerOwner = useIsServerOwner();
  const setters: PageSetters = { setPacks, setFavorites, setDiscover, setActionError };

  // The first load (and the retry): both lists must answer.
  const [loadState, reloadPage] = useQuery(() => loadPanel(setters), []);
  // Discover searches as you type: each keystroke restarts the 300 ms wait,
  // and a new keystroke interrupts the wait or search still running.
  useQuery(
    () =>
      Effect.sleep(DISCOVER_SEARCH_DEBOUNCE_MS).pipe(Effect.andThen(searchPacks(query, setters))),
    [query],
  );
  const [, runRefresh] = useAction<void, void, never>(() => refreshPanel(setters), {
    mode: 'replace',
  });
  // Moves are disabled while one runs, so the page-level action never drops a drag.
  const [moveState, runMove] = useAction<{ activeId: string; overId: string }, void, never>(
    ({ activeId, overId }) => dragPack(packs ?? [], activeId, overId, setters),
  );

  const loadFailure = isWaiting(loadState) ? undefined : failureOf(loadState);
  const status: PageStatus = AsyncResult.isSuccess(loadState)
    ? 'ready'
    : loadFailure !== undefined
      ? 'error'
      : 'loading';
  const loadError =
    loadFailure !== undefined ? failureText(loadFailure, 'Could not load stickers') : '';
  const moving = isWaiting(moveState);

  const myPacks = (packs ?? []).filter((pack) => userId !== undefined && pack.ownerId === userId);
  const addedPacks = (packs ?? []).filter(
    (pack) => userId === undefined || pack.ownerId !== userId,
  );
  const panelIds = new Set((packs ?? []).map((pack) => pack.id));

  if (editingPackId !== undefined) {
    const pack = packs?.find((row) => row.id === editingPackId);
    return (
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
    );
  }

  if (creating) {
    return (
      <PackEditor
        onDone={() => {
          setCreating(false);
          runRefresh();
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <SettingsShell
      title="Stickers"
      onBack={() => navigate('/settings')}
      action={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label="Import from Telegram"
            onClick={() => setImporting(true)}
          >
            <Upload className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Import from Telegram</span>
          </Button>
          <Button type="button" aria-label="New pack" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">New pack</span>
          </Button>
        </div>
      }
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

          <SegmentedControl
            options={TABS}
            value={tab}
            onChange={setTab}
            ariaLabel="Sticker sections"
            mode="tabs"
          />

          {tab === 'mine' && (
            <>
              <section aria-label="My packs">
                {myPacks.length === 0 ? (
                  <p className="text-[14px] text-muted-foreground">
                    No packs yet. Make one from your photos with Create pack, or import one from
                    Telegram.
                  </p>
                ) : (
                  <SortableList
                    ids={myPacks.map((pack) => pack.id)}
                    disabled={moving}
                    labelOf={(id) => myPacks.find((pack) => pack.id === id)?.title ?? id}
                    onReorder={(fromId, toId) => runMove({ activeId: fromId, overId: toId })}
                  >
                    <ul className="overflow-hidden rounded-xl border border-border bg-surface">
                      {myPacks.map((pack) => (
                        <MyPackRow
                          key={pack.id}
                          pack={pack}
                          disabled={moving}
                          setters={setters}
                          onEdit={(packId) => setEditingPackId(packId)}
                          onDelete={(target) => setDeletingPack(target)}
                          registerDelete={registerDelete}
                        />
                      ))}
                    </ul>
                  </SortableList>
                )}
              </section>

              {addedPacks.length > 0 && (
                <section aria-label="Added packs" className="flex flex-col gap-2">
                  <h2 className="px-1 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle-foreground">
                    Added
                  </h2>
                  <ul className="overflow-hidden rounded-xl border border-border bg-surface">
                    {addedPacks.map((pack) => (
                      <AddedPackRow key={pack.id} pack={pack} setters={setters} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {tab === 'discover' && (
            <section aria-label="Discover" className="flex flex-col gap-2">
              <SearchField
                value={query}
                aria-label="Search shared packs"
                placeholder="Search shared packs"
                maxLength={60}
                onChange={(event) => setQuery(event.target.value)}
              />
              {discover === undefined ? (
                <StateMessage kind="loading" size="inline" title="Loading…" />
              ) : discover.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">
                  No shared packs found. Try another search, or make your own with Create pack.
                </p>
              ) : (
                <ul className="overflow-hidden rounded-xl border border-border bg-surface">
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
          )}

          {tab === 'favorites' && (
            <section aria-label="Favorites" className="flex flex-col gap-2">
              {favorites === undefined ? (
                <StateMessage kind="loading" size="inline" title="Loading…" />
              ) : favorites.length === 0 ? (
                <p className="text-[14px] text-muted-foreground">
                  No favorites yet. Open the sticker panel in any chat and tap the star on a sticker
                  to keep it here.
                </p>
              ) : (
                <ul
                  className="grid grid-cols-4 gap-2 sm:grid-cols-6"
                  aria-label="Favorite stickers"
                >
                  {favorites.map((sticker) => (
                    <FavoriteRow key={sticker.id} sticker={sticker} setters={setters} />
                  ))}
                </ul>
              )}
            </section>
          )}
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
