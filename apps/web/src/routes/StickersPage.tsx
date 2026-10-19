import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Plus, Upload, Star } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PackEditor } from '@/components/PackEditor';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { SearchField } from '@/components/ui/search-field';
import { SortableList } from '@/components/ui/sortable-list';
import { TextInput } from '@/components/ui/text-input';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { importTelegramStickers, type Sticker, type StickerPack } from '@/lib/api';
import { fromApi, type ApiFailure, failureOf, isWaiting } from '@zilar/client-core';
import {
  type PageSetters,
  type PageStatus,
  dragPack,
  failureText,
  loadPanel,
  refreshPanel,
  searchPacks,
  unstarSticker,
} from '@/components/sticker/pageActions';
import { AddedPackRow, DiscoverPackRow, MyPackRow } from '@/components/sticker/PackRows';

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
  // One delete dialog for the page; each row registers its own action, so a double click is ignored.
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
  // The Telegram import dialog stays visible; a 501 only disables the button's usual flow.
  // The owner link starts hidden, so it never flashes for a non-owner.
  const [importing, setImporting] = useState(false);
  const isServerOwner = useIsServerOwner();
  const setters: PageSetters = { setPacks, setFavorites, setDiscover, setActionError };

  const [loadState, reloadPage] = useQuery(() => loadPanel(setters), []);
  // Discover searches as you type: each keystroke restarts the 300 ms wait and interrupts a search.
  useQuery(
    () =>
      Effect.sleep(DISCOVER_SEARCH_DEBOUNCE_MS).pipe(Effect.andThen(searchPacks(query, setters))),
    [query],
  );
  const [, runRefresh] = useAction<void, void, never>(() => refreshPanel(setters), {
    mode: 'replace',
  });
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
                    No packs yet. Make one from your photos with New pack, or import one from
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
                  <SectionLabel>Added</SectionLabel>
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
                  No shared packs found. Try another search, or make your own with New pack.
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
            // The dialog shows the not-set-up state itself; the entry point learns the feature is off.
          }}
          isOwner={isServerOwner}
        />
      )}
    </SettingsShell>
  );
}

/** Telegram import dialog; imported packs are personal-use only. */
function TelegramImportDialog({
  onDone,
  onClose,
  onUnavailable,
  isOwner,
  importFn = importTelegramStickers,
}: {
  onDone: () => void;
  onClose: () => void;
  onUnavailable?: () => void;
  isOwner?: boolean | undefined;
  importFn?: typeof importTelegramStickers;
}) {
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  const [importState, runImport] = useAction((value: string) =>
    fromApi(() => importFn(value)).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => {
          if (failure.status === 501) {
            onUnavailable?.();
          }
        }),
      ),
    ),
  );
  const busy = isWaiting(importState);
  const failure = busy ? undefined : failureOf(importState);
  const result = !busy && AsyncResult.isSuccess(importState) ? importState.value : undefined;
  // A saved token can be revoked at Telegram's side; that is not a form error.
  const unavailable = failure?.status === 501;
  const tokenInvalid = failure?.code === 'token_invalid';
  const hookOwner = useIsServerOwner();
  const ownerView = isOwner ?? hookOwner;
  const error = notice !== '' ? notice : failure !== undefined ? importErrorText(failure) : '';

  const run = (): void => {
    if (input.trim() === '') {
      setNotice('Paste a pack link or name first.');
      return;
    }
    setNotice('');
    runImport(input);
  };

  if (unavailable) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Telegram import is not set up"
        ariaLabel="Telegram import not set up"
        size="sm"
      >
        <p className="mt-2 text-[14px] text-muted-foreground">
          Telegram import is not set up on this server.
        </p>
        {ownerView ? (
          <p className="mt-3 text-[14px]">
            <Link to="/settings/integrations" className="text-accent underline hover:no-underline">
              Open the integrations settings to add a bot token.
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-[14px] text-muted-foreground">
            Ask the person who runs this server to set it up.
          </p>
        )}
      </Dialog>
    );
  }

  if (tokenInvalid) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="The Telegram token was rejected"
        ariaLabel="Telegram token rejected"
        size="sm"
      >
        {ownerView ? (
          <p className="mt-2 text-[14px]">
            The Telegram token was rejected. The server owner needs to update it —{' '}
            <Link to="/settings/integrations" className="text-accent underline hover:no-underline">
              open the integrations settings.
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-muted-foreground">
            The Telegram token was rejected. The server owner needs to update it.
          </p>
        )}
      </Dialog>
    );
  }

  if (result !== undefined) {
    return (
      <Dialog
        open
        onClose={() => {
          onDone();
          onClose();
        }}
        title={`Imported from Telegram: ${result.pack.title}`}
        ariaLabel="Telegram import result"
        size="sm"
      >
        <p className="mt-2 text-[14px]">
          {result.imported} sticker{result.imported === 1 ? '' : 's'} added
          {result.skippedAnimated > 0 &&
            `, ${result.skippedAnimated} animated sticker${result.skippedAnimated === 1 ? ' was' : 's were'} skipped`}
          {result.skippedInvalid > 0 &&
            `, ${result.skippedInvalid} file${result.skippedInvalid === 1 ? ' was' : 's were'} skipped as invalid`}
          .
        </p>
        {result.partial === true && (
          <p className="mt-1 text-[14px] text-muted-foreground">
            The import ran out of time — run it again to fill in the rest.
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">
          Imported packs are for personal use: this pack stays private and its art belongs to its
          creators.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import from Telegram"
      size="sm"
      busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        run();
      }}
      {...(error === '' ? {} : { error })}
      actions={
        <Button type="submit" disabled={busy} size="lg">
          {busy ? 'Importing…' : 'Import'}
        </Button>
      }
    >
      <p className="mt-2 text-[13px] text-muted-foreground">
        Paste a pack link (<code>t.me/addstickers/…</code>) or the bare pack name. Only static
        stickers import — animated and video ones are skipped. Imported packs are for personal use:
        they stay private and cannot be shared server-wide.
      </p>
      <div className="mt-3">
        <TextInput
          label="Pack link or name"
          data-autofocus
          value={input}
          placeholder="t.me/addstickers/FunCats"
          maxLength={512}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

function importErrorText(failure: ApiFailure): string {
  if (failure.status === 429) {
    return 'Too many imports — try again in an hour.';
  }
  if (failure.code === 'pack_not_found') {
    return 'That Telegram sticker pack was not found.';
  }
  if (failure.code === 'custom_emoji_unsupported') {
    return 'Custom emoji sets cannot be imported as sticker packs.';
  }
  if (failure.code === 'try_later') {
    return 'Telegram is busy — try again later.';
  }
  return failure.code === 'unknown_error' ? 'The import failed.' : failure.message;
}
