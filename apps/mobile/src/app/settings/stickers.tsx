import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import {
  Check,
  ChevronRight,
  CircleMinus,
  Download,
  Globe,
  Plus,
  Star,
  Sticker,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, View, Pressable } from 'react-native';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { PackSheet } from '@/components/stickers/pack-sheet';
import { TelegramImportSheet } from '@/components/stickers/telegram-import-sheet';
import {
  DISCOVER_ERROR,
  type StickerTab,
  useStickersPanel,
} from '@/components/stickers/use-stickers-panel';
import { SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { ICON, FOREGROUND, MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import { fromApi, type PanelPack } from '@zilar/client-core';
import {
  type StickerPack,
  isSameOriginStickerUrl,
  stickerImageSource,
  type StickerItem,
} from '@/lib/stickers';
import { Image } from 'expo-image';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { packCountLabel } from '@/components/stickers/tile-size';
import { cn } from '@/lib/utils';

function FavoritesTab({
  favorites,
  tile,
  token,
  busy,
  actionError,
  onUnstar,
}: {
  favorites: StickerItem[];
  tile: number;
  token: string | undefined;
  busy: boolean;
  actionError: string;
  onUnstar: (stickerId: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-[16px] font-semibold text-foreground">Favorites</Text>
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}
      {favorites.length === 0 ? (
        <StateMessage kind="empty" title="No favorites yet. Starred stickers show up here." />
      ) : (
        <View accessibilityLabel="Favorite stickers" className="flex-row flex-wrap gap-2">
          {favorites.map((sticker) => (
            <View
              key={sticker.id}
              className="items-center justify-center rounded-[10px] border border-border bg-surface p-1"
              style={{ width: tile, height: tile }}
            >
              {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                <Image
                  source={stickerImageSource(sticker.url, API_URL, token)}
                  accessibilityLabel={sticker.emoji ?? 'Sticker'}
                  style={{ width: tile - 8, height: tile - 8 }}
                  contentFit="contain"
                />
              ) : (
                <Text accessibilityLabel={sticker.emoji ?? 'Sticker'}>{sticker.emoji ?? ''}</Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove favorite"
                disabled={busy}
                hitSlop={10}
                onPress={() => onUnstar(sticker.id)}
                className="absolute right-0.5 top-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/70 active:opacity-70 disabled:opacity-60"
              >
                <Star size={12} color={FOREGROUND} fill={FOREGROUND} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

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

function DiscoverTab({
  discover,
  discoverBusy,
  discoverError,
  query,
  actionError,
  busy,
  busyId,
  panelIds,
  token,
  onQueryChange,
  onSearch,
  onAdd,
  onRemove,
  onOpenPackLink,
}: {
  discover: PanelPack[] | undefined;
  discoverBusy: boolean;
  discoverError: string;
  query: string;
  actionError: string;
  busy: boolean;
  busyId: string | null;
  panelIds: Set<string>;
  token: string | undefined;
  onQueryChange: (value: string) => void;
  onSearch: (search: string) => void;
  onAdd: (packId: string) => void;
  onRemove: (pack: PanelPack) => void;
  onOpenPackLink: (packId: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-[14px] text-muted-foreground">
        Find shared packs from anyone on this server and add them to your panel.
      </Text>
      <SearchField
        value={query}
        onChangeText={onQueryChange}
        onSubmitEditing={() => onSearch(query)}
        maxLength={60}
        returnKeyType="search"
        placeholder="Search shared packs"
        accessibilityLabel="Search sticker packs"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}
      {discoverBusy ? (
        <StateMessage kind="loading" title="Searching…" />
      ) : discover === undefined || discoverError !== '' ? (
        <StateMessage
          kind="error"
          title={discoverError === '' ? DISCOVER_ERROR : discoverError}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading shared packs',
            onPress: () => onSearch(query),
          }}
        />
      ) : discover.length === 0 ? (
        <View className="items-center px-6 pt-12">
          <Text className="text-center text-[15px] text-muted-foreground">
            No shared packs found. Try another search.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-2xl border border-border bg-surface">
          {discover.map((pack, index) => {
            const added = panelIds.has(pack.id);
            return (
              <PackCard
                key={pack.id}
                inList
                divider={index < discover.length - 1}
                pack={pack}
                token={token}
                accessibilityLabel={`Open ${pack.title}`}
                onPress={() => onOpenPackLink(pack.id)}
                action={
                  added ? (
                    <View className="flex-row items-center gap-2">
                      <Check size={18} color={SEEN} aria-hidden />
                      <IconButton
                        label={`Remove ${pack.title} from panel`}
                        disabled={busy}
                        onPress={() => onRemove(pack)}
                      >
                        <CircleMinus size={18} color={ICON} />
                      </IconButton>
                    </View>
                  ) : (
                    <IconButton
                      label={`Add ${pack.title}`}
                      disabled={busy}
                      onPress={() => onAdd(pack.id)}
                    >
                      {busyId === pack.id ? (
                        <ActivityIndicator size="small" color={ICON} />
                      ) : (
                        <Plus size={18} color={ICON} />
                      )}
                    </IconButton>
                  )
                }
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

function PacksTab({
  packs,
  token,
  meId,
  busy,
  actionError,
  onRemove,
  onOpenPack,
  onOpenPackLink,
  onImport,
  onOpenDiscover,
}: {
  packs: PanelPack[];
  token: string | undefined;
  meId: string | undefined;
  busy: boolean;
  actionError: string;
  onRemove: (pack: StickerPack) => void;
  onOpenPack: (packId: string) => void;
  onOpenPackLink: (packId: string) => void;
  onImport: () => void;
  onOpenDiscover: () => void;
}) {
  // While the viewer id is still unknown, every pack counts as your own so no
  // Added row flashes a remove key on a pack you own.
  const own =
    meId === undefined
      ? packs
      : packs.filter((pack) => pack.ownerId === undefined || pack.ownerId === meId);
  const added = meId === undefined ? [] : packs.filter((pack) => pack.ownerId !== meId);

  return (
    <View className="gap-2">
      {actionError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {actionError}
        </Text>
      ) : null}

      {own.length === 0 ? (
        <StateMessage
          kind="empty"
          icon={Sticker}
          title="No packs on your panel yet. Look in Discover for shared packs to add."
          action={{
            label: 'Open Discover',
            accessibilityLabel: 'Open Discover',
            onPress: onOpenDiscover,
          }}
        />
      ) : null}

      <View className="overflow-hidden rounded-2xl border border-border bg-surface">
        {own.map((pack) => (
          <PackCard
            key={pack.id}
            inList
            pack={pack}
            token={token}
            meId={meId}
            accessibilityLabel={`Open ${pack.title}`}
            onPress={() => onOpenPack(pack.id)}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import from Telegram"
          disabled={busy}
          onPress={onImport}
          className="flex-row items-center gap-3 px-3 py-3 active:bg-surface-raised disabled:opacity-50"
        >
          <View className="h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-raised">
            <Download size={18} color={MUTED_FOREGROUND} />
          </View>
          <Text className="text-[15px] text-muted-foreground">Import from Telegram</Text>
        </Pressable>
      </View>

      {added.length > 0 ? (
        <View className="mt-4 gap-2">
          <SectionLabel>Added</SectionLabel>
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            {added.map((pack, index) => (
              <PackCard
                key={pack.id}
                inList
                divider={index < added.length - 1}
                pack={pack}
                token={token}
                meId={meId}
                accessibilityLabel={`Open ${pack.title}`}
                onPress={() => onOpenPackLink(pack.id)}
                action={
                  <IconButton
                    label={`Remove ${pack.title} from panel`}
                    disabled={busy}
                    onPress={() => onRemove(pack)}
                  >
                    <CircleMinus size={18} color={ICON} />
                  </IconButton>
                }
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function packMeta(pack: PanelPack, own: boolean): string {
  const count = packCountLabel(pack.stickers.length);
  if (own) {
    return pack.importedFrom === undefined ? count : `${count} · Telegram`;
  }
  return pack.ownerHandle === undefined || pack.ownerHandle === null
    ? count
    : `${count} · @${pack.ownerHandle}`;
}

function PackCard({
  pack,
  token,
  meId,
  onPress,
  action,
  accessibilityLabel,
  inList = false,
  divider = true,
}: {
  pack: PanelPack;
  token: string | undefined;
  meId?: string | undefined;
  onPress?: (() => void) | undefined;
  action?: React.ReactNode;
  accessibilityLabel?: string;
  inList?: boolean;
  divider?: boolean;
}) {
  const thumbs = pack.stickers.slice(0, 4);
  const own = meId !== undefined && pack.ownerId !== undefined && pack.ownerId === meId;
  const trailing =
    action ?? (onPress === undefined ? null : <ChevronRight size={16} color={MUTED_FOREGROUND} />);
  const body = (
    <View className="flex-row items-center gap-3">
      <View accessibilityElementsHidden className="flex-row gap-1">
        {thumbs.length === 0 ? (
          <View className="h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-raised">
            <Sticker size={18} color={MUTED_FOREGROUND} />
          </View>
        ) : (
          thumbs.map((sticker) => (
            <View
              key={sticker.id}
              className="h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-surface-raised"
            >
              {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                <Image
                  source={stickerImageSource(sticker.url, API_URL, token)}
                  style={{ width: 36, height: 36 }}
                  contentFit="contain"
                />
              ) : null}
            </View>
          ))
        )}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
            {pack.title}
          </Text>
          {pack.visibility === 'server' ? (
            <Globe size={14} color={MUTED_FOREGROUND} accessibilityLabel="Shared" />
          ) : null}
        </View>
        <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
          {packMeta(pack, own)}
        </Text>
      </View>
      {trailing === null ? null : <View className="shrink-0">{trailing}</View>}
    </View>
  );
  const container = cn(
    'px-3 py-2.5',
    inList
      ? divider
        ? 'border-b border-divider'
        : undefined
      : 'rounded-xl border border-border bg-surface',
  );
  return onPress === undefined ? (
    <View className={container}>{body}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? pack.title}
      onPress={onPress}
      className={cn(container, 'active:bg-surface-raised')}
    >
      {body}
    </Pressable>
  );
}
