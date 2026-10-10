import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { DiscoverTab } from '@/components/stickers/discover-tab';
import { FavoritesTab } from '@/components/stickers/favorites-tab';
import { PacksTab } from '@/components/stickers/packs-tab';
import { TelegramImportSheet } from '@/components/stickers/telegram-import-sheet';
import { type StickerTab, useStickersPanel } from '@/components/stickers/use-stickers-panel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { SettingsScreenShell } from '@/components/settings/screen-shell';

export { favoriteTileSize } from '@/components/stickers/tile-size';

const TABS: readonly { key: StickerTab; label: string }[] = [
  { key: 'packs', label: 'My packs' },
  { key: 'discover', label: 'Discover' },
  { key: 'favorites', label: 'Favorites' },
];

const isStickerTab = (value: string): value is StickerTab =>
  TABS.some((entry) => entry.key === value);

const LOAD_ERROR = 'Could not load your stickers.';

/**
 * Settings → Stickers (T-0187, the mobile twin of web's `StickersPage`):
 * the panel packs in order with Remove and move up/down, the shared
 * Discover packs with search and Add, and the starred Favorites grid.
 * The pack editor lives at `/settings/sticker-pack` (T-0191) and the
 * Telegram importer in `TelegramImportSheet` (T-0207).
 */
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

  return (
    <SettingsScreenShell
      title="Stickers"
      subtitle="Your packs, shared packs and favorites."
      onBack={() => router.back()}
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
            onMove={movePack}
            onRemove={askRemove}
            onEdit={(packId) =>
              router.push({ pathname: '/settings/sticker-pack', params: { id: packId } })
            }
            onCreate={() => router.push('/settings/sticker-pack')}
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
