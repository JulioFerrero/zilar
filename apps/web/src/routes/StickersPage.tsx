import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { AiPageShell } from '@/components/ais/AiPageShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PackEditor } from '@/components/PackEditor';
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

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Settings → Stickers (T-0121): my packs, packs I added, discover with
 * search, favorites, and the pack creator/editor.
 */
export function StickersPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const userId =
    auth.status === 'authenticated' && auth.user !== undefined ? auth.user.id : undefined;

  const [packs, setPacks] = useState<StickerPack[] | undefined>(undefined);
  const [favorites, setFavorites] = useState<Sticker[] | undefined>(undefined);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [discover, setDiscover] = useState<StickerPack[] | undefined>(undefined);
  const [discoverBusy, setDiscoverBusy] = useState(true);
  const [actionError, setActionError] = useState('');
  const [editingPackId, setEditingPackId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [deletingPack, setDeletingPack] = useState<StickerPack | undefined>(undefined);
  const [movingPackId, setMovingPackId] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const [panel, starred] = await Promise.all([listStickerPacks(), listStickerFavorites()]);
      setPacks(panel);
      setFavorites(starred);
      setStatus('ready');
    } catch (cause) {
      setError(errorMessageOf(cause, 'Could not load stickers'));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // Async wrapper: the loads settle after mount, so no synchronous
    // setState-in-effect (the retry button reuses `load` directly).
    const run = async (): Promise<void> => {
      await load();
    };
    void run();
  }, [load]);

  const search = useCallback(async () => {
    setDiscoverBusy(true);
    setActionError('');
    try {
      const page = await discoverStickerPacks(query);
      setDiscover(page.packs);
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not search packs'));
    } finally {
      setDiscoverBusy(false);
    }
  }, [query]);

  useEffect(() => {
    let active = true;
    discoverStickerPacks()
      .then((page) => {
        if (active) {
          setDiscover(page.packs);
        }
      })
      .catch(() => {
        // Discover is best-effort on first paint; an explicit search reports.
      })
      .finally(() => {
        if (active) {
          setDiscoverBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const myPacks = (packs ?? []).filter((pack) => userId !== undefined && pack.ownerId === userId);
  const addedPacks = (packs ?? []).filter(
    (pack) => userId === undefined || pack.ownerId !== userId,
  );
  const panelIds = new Set((packs ?? []).map((pack) => pack.id));

  const refresh = async (): Promise<void> => {
    try {
      const panel = await listStickerPacks();
      setPacks(panel);
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not refresh packs'));
    }
  };

  const toggleVisibility = async (pack: StickerPack): Promise<void> => {
    setActionError('');
    try {
      const updated = await patchStickerPack(pack.id, {
        visibility: pack.visibility === 'server' ? 'private' : 'server',
      });
      setPacks((previous) => previous?.map((row) => (row.id === pack.id ? updated : row)));
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not change the visibility'));
    }
  };

  const addPack = async (packId: string): Promise<void> => {
    setActionError('');
    try {
      await addStickerPanelPack(packId);
      await refresh();
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not add the pack'));
    }
  };

  const removePack = async (packId: string): Promise<void> => {
    setActionError('');
    try {
      await removeStickerPanelPack(packId);
      await refresh();
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not remove the pack'));
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deletingPack === undefined) {
      return;
    }
    const packId = deletingPack.id;
    setDeletingPack(undefined);
    setActionError('');
    try {
      await deleteStickerPack(packId);
      setPacks((previous) => previous?.filter((row) => row.id !== packId));
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not delete the pack'));
    }
  };

  const unstar = async (stickerId: string): Promise<void> => {
    setActionError('');
    try {
      await removeStickerFavorite(stickerId);
      setFavorites((previous) => previous?.filter((row) => row.id !== stickerId));
    } catch (cause) {
      setActionError(errorMessageOf(cause, 'Could not remove the favorite'));
    }
  };

  // Panel order is the panel list order; moving a pack sends the whole
  // new order to the atomic reorder endpoint, so a failure leaves the
  // server order untouched (the UI then restores it too).
  const movePack = async (packId: string, direction: -1 | 1): Promise<void> => {
    const ordered = packs ?? [];
    const index = ordered.findIndex((pack) => pack.id === packId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) {
      return;
    }
    setMovingPackId(packId);
    setActionError('');
    const next = [...ordered];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    const previous = ordered;
    setPacks(next);
    try {
      await reorderStickerPanelPacks(next.map((pack) => pack.id));
    } catch (cause) {
      setPacks(previous);
      setActionError(errorMessageOf(cause, 'Could not reorder packs'));
    } finally {
      setMovingPackId(undefined);
    }
  };

  if (editingPackId !== undefined) {
    const pack = packs?.find((row) => row.id === editingPackId);
    return (
      <AiPageShell title="Edit sticker pack" onBack={() => setEditingPackId(undefined)}>
        <PackEditor
          packId={editingPackId}
          initialTitle={pack?.title ?? ''}
          initialVisibility={pack?.visibility ?? 'private'}
          initialStickers={pack?.stickers ?? []}
          onDone={() => {
            setEditingPackId(undefined);
            void refresh();
          }}
          onCancel={() => setEditingPackId(undefined)}
        />
      </AiPageShell>
    );
  }

  if (creating) {
    return (
      <AiPageShell title="New sticker pack" onBack={() => setCreating(false)}>
        <PackEditor
          onDone={() => {
            setCreating(false);
            void refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      </AiPageShell>
    );
  }

  return (
    <AiPageShell
      title="Stickers"
      subtitle="Make packs from your images, share them, and star favorites."
      onBack={() => navigate('/')}
    >
      {status === 'loading' && <p className="text-[15px] text-muted-foreground">Loading…</p>}

      {status === 'error' && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p role="alert" className="text-[15px] text-danger">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-foreground hover:bg-accent/90"
          >
            Retry
          </button>
        </div>
      )}

      {status === 'ready' && (
        <div className="flex max-w-2xl flex-col gap-6">
          {actionError !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {actionError}
            </p>
          )}

          <section aria-label="My packs">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">My packs</h2>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-accent-foreground hover:bg-accent/90"
              >
                Create pack
              </button>
            </div>
            {myPacks.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                No packs yet. Make one from your photos.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {myPacks.map((pack) => (
                  <li
                    key={pack.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-list-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{pack.title}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {pack.stickers.length} stickers ·{' '}
                        {pack.visibility === 'server' ? 'Shared' : 'Private'}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Move ${pack.title} up`}
                      disabled={movingPackId !== undefined}
                      onClick={() => void movePack(pack.id, -1)}
                      className="rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${pack.title} down`}
                      disabled={movingPackId !== undefined}
                      onClick={() => void movePack(pack.id, 1)}
                      className="rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleVisibility(pack)}
                      className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {pack.visibility === 'server' ? 'Make private' : 'Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPackId(pack.id)}
                      className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void removePack(pack.id)}
                      className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Remove from panel
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingPack(pack)}
                      className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {addedPacks.length > 0 && (
            <section aria-label="Packs I added">
              <h2 className="mb-2 text-[16px] font-semibold">Packs I added</h2>
              <ul className="flex flex-col gap-1">
                {addedPacks.map((pack) => (
                  <li
                    key={pack.id}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-list-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{pack.title}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {pack.stickers.length} stickers
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void removePack(pack.id)}
                      className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Discover">
            <h2 className="mb-2 text-[16px] font-semibold">Discover</h2>
            <form
              className="mb-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
              <input
                value={query}
                aria-label="Search sticker packs"
                placeholder="Search shared packs"
                maxLength={60}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <button
                type="submit"
                disabled={discoverBusy}
                className="rounded-full bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-60"
              >
                Search
              </button>
            </form>
            {discover === undefined ? (
              <p className="text-[14px] text-muted-foreground">Loading…</p>
            ) : discover.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">No shared packs found.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {discover.map((pack) => {
                  const added = panelIds.has(pack.id);
                  return (
                    <li
                      key={pack.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-list-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{pack.title}</span>
                        <span className="block text-[13px] text-muted-foreground">
                          {pack.stickers.length} stickers
                        </span>
                      </span>
                      {added ? (
                        <button
                          type="button"
                          onClick={() => void removePack(pack.id)}
                          className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void addPack(pack.id)}
                          className="rounded-full bg-accent px-3 py-1 text-[13px] font-medium text-accent-foreground hover:bg-accent/90"
                        >
                          Add
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-label="Favorites">
            <h2 className="mb-2 text-[16px] font-semibold">Favorites</h2>
            {favorites === undefined ? (
              <p className="text-[14px] text-muted-foreground">Loading…</p>
            ) : favorites.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">
                No favorites yet. Star a sticker in the panel to keep it here.
              </p>
            ) : (
              <ul className="grid grid-cols-6 gap-1" aria-label="Favorite stickers">
                {favorites.map((sticker) => (
                  <li key={sticker.id} className="relative">
                    <img
                      src={sticker.url}
                      alt={sticker.emoji ?? 'Sticker'}
                      loading="lazy"
                      width={72}
                      height={72}
                      className="size-[72px] rounded-[8px] object-contain"
                    />
                    <button
                      type="button"
                      aria-label={`Unfavorite ${sticker.emoji ?? 'sticker'}`}
                      onClick={() => void unstar(sticker.id)}
                      className="absolute top-0 right-0 rounded-full bg-black/60 px-1.5 py-0.5 text-[12px] text-white"
                    >
                      ★
                    </button>
                  </li>
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
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeletingPack(undefined)}
        />
      )}
    </AiPageShell>
  );
}
