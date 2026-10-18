import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { DiscoverTab } from '@/components/stickers/discover-tab';
import { FavoritesTab } from '@/components/stickers/favorites-tab';
import { PackSheet } from '@/components/stickers/pack-sheet';
import { PacksTab } from '@/components/stickers/packs-tab';
import { TelegramImportSheet } from '@/components/stickers/telegram-import-sheet';
import { type StickerTab, useStickersPanel } from '@/components/stickers/use-stickers-panel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { ICON } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import type { StickerPack } from '@/lib/stickers';

export { favoriteTileSize } from '@/components/stickers/tile-size';

const TABS: readonly { key: StickerTab; label: string }[] = [
  { key: 'packs', label: 'My packs' },
  { key: 'discover', label: 'Discover' },
  { key: 'favorites', label: 'Favorites' },
];

const isStickerTab = (value: string): value is StickerTab =>
  TABS.some((entry) => entry.key === value);

const LOAD_ERROR = 'Could not load your stickers.';
const VISIBILITY_ERROR = 'Could not change who can find this pack. Try again.';
const DELETE_ERROR = 'Could not delete the pack. Try again.';

export default function StickersScreen() {
  return (
    <RequireStickersAuth>
      <StickersBody />
    </RequireStickersAuth>
  );
}

function StickersBody() {
  const router = useRouter();
  const {
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
    meId,
    reload,
    loadDiscover,
    addPack,
    askRemove,
    movePack,
    unstar,
    panelIds,
    tile,
  } = useStickersPanel();

  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityError, setVisibilityError] = useState('');
  const [deletingPack, setDeletingPack] = useState<StickerPack | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteBusyRef = useRef(false);

  const selectedPack =
    selectedPackId === null ? null : (packs.find((pack) => pack.id === selectedPackId) ?? null);
  const selectedIndex =
    selectedPack === null ? -1 : packs.findIndex((pack) => pack.id === selectedPack.id);

  const openEditor = (packId: string): void =>
    router.push({ pathname: '/settings/sticker-pack', params: { id: packId } });

  const closeSheet = (): void => {
    setSelectedPackId(null);
    setVisibilityError('');
  };

  const changeVisibility = (pack: StickerPack, visibility: 'private' | 'server'): void => {
    if (visibilityBusy) {
      return;
    }
    setVisibilityBusy(true);
    setVisibilityError('');
    Effect.runFork(
      fromApi(() => api.patchStickerPack(pack.id, { visibility })).pipe(
        Effect.tap(() => Effect.sync(() => reload())),
        Effect.catch(() => Effect.sync(() => setVisibilityError(VISIBILITY_ERROR))),
        Effect.ensuring(Effect.sync(() => setVisibilityBusy(false))),
      ),
    );
  };

  const confirmDelete = (): void => {
    if (deletingPack === null || deleteBusyRef.current) {
      return;
    }
    const packId = deletingPack.id;
    deleteBusyRef.current = true;
    setDeleteBusy(true);
    setDeleteError('');
    Effect.runFork(
      fromApi(() => api.deleteStickerPack(packId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setDeletingPack(null);
            reload();
          }),
        ),
        Effect.catch(() => Effect.sync(() => setDeleteError(DELETE_ERROR))),
        Effect.ensuring(
          Effect.sync(() => {
            deleteBusyRef.current = false;
            setDeleteBusy(false);
          }),
        ),
      ),
    );
  };

  return (
    <SettingsScreenShell
      title="Stickers"
      onBack={() => router.back()}
      right={
        <IconButton label="New pack" onPress={() => router.push('/settings/sticker-pack')}>
          <Plus size={18} color={ICON} />
        </IconButton>
      }
    >
      <View className="gap-4">
        <SegmentedControl
          options={TABS.map((entry) => ({ value: entry.key, label: entry.label }))}
          value={tab}
          onChange={(next) => {
            if (isStickerTab(next)) {
              openTab(next);
            }
          }}
          accessibilityLabel="Sticker sections"
          className="mb-2"
        />

        {status === 'loading' ? <StateMessage kind="loading" title="Loading stickers…" /> : null}

        {status === 'error' ? (
          <StateMessage
            kind="error"
            title={LOAD_ERROR}
            action={{
              label: 'Retry',
              accessibilityLabel: 'Retry loading stickers',
              onPress: reload,
            }}
          />
        ) : null}

        {status === 'ready' && tab === 'packs' ? (
          <PacksTab
            packs={packs}
            token={token}
            meId={meId}
            busy={busy}
            actionError={actionError}
            onRemove={askRemove}
            onOpenPack={(packId) => {
              setVisibilityError('');
              setSelectedPackId(packId);
            }}
            onOpenPackLink={(packId) =>
              router.push({ pathname: '/stickers/[packId]', params: { packId } })
            }
            onImport={openImport}
            onOpenDiscover={() => openTab('discover')}
          />
        ) : null}

        {status === 'ready' && tab === 'discover' ? (
          <DiscoverTab
            discover={discover}
            discoverBusy={discoverBusy}
            discoverError={discoverError}
            query={query}
            actionError={actionError}
            busy={busy}
            busyId={busyId}
            panelIds={panelIds}
            token={token}
            onQueryChange={setQuery}
            onSearch={loadDiscover}
            onAdd={addPack}
            onRemove={askRemove}
            onOpenPackLink={(packId) =>
              router.push({ pathname: '/stickers/[packId]', params: { packId } })
            }
          />
        ) : null}

        {status === 'ready' && tab === 'favorites' ? (
          <FavoritesTab
            favorites={favorites}
            tile={tile}
            token={token}
            busy={busy}
            actionError={actionError}
            onUnstar={unstar}
          />
        ) : null}
      </View>

      <PackSheet
        pack={selectedPack}
        token={token}
        meId={meId}
        busy={busy}
        canMoveUp={selectedIndex > 0}
        canMoveDown={selectedIndex >= 0 && selectedIndex < packs.length - 1}
        visibilityBusy={visibilityBusy}
        visibilityError={visibilityError}
        onMove={movePack}
        onEdit={(packId) => {
          closeSheet();
          openEditor(packId);
        }}
        onMakePrivate={(pack) => changeVisibility(pack, 'private')}
        onMakeShared={(pack) => changeVisibility(pack, 'server')}
        onRemove={(pack) => {
          closeSheet();
          askRemove(pack);
        }}
        onDelete={(pack) => {
          closeSheet();
          setDeleteError('');
          setDeletingPack(pack);
        }}
        onClose={closeSheet}
      />

      <ConfirmDialog
        visible={confirming !== null}
        title="Remove this pack?"
        message={
          confirming === null
            ? ''
            : `${confirming.title} leaves your sticker panel. You can add it again from Discover if it is still shared.`
        }
        error={confirmError}
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmRemove}
        confirmAccessibilityLabel={
          confirming === null ? 'Remove pack' : `Remove ${confirming.title}`
        }
        destructive
      />

      <ConfirmDialog
        visible={deletingPack !== null}
        title="Delete this pack?"
        message="The pack and its files are deleted. Messages already sent keep their sticker URL, which no longer loads a sticker."
        error={deleteError}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={deleteBusy}
        onCancel={() => setDeletingPack(null)}
        onConfirm={confirmDelete}
        confirmAccessibilityLabel={
          deletingPack === null ? 'Delete pack' : `Delete ${deletingPack.title}`
        }
        destructive
      />

      <TelegramImportSheet
        key={`telegram-import-${importNonce}`}
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={reload}
        onOpenPack={(packId) =>
          router.push({ pathname: '/settings/sticker-pack', params: { id: packId } })
        }
        api={api}
      />
    </SettingsScreenShell>
  );
}
