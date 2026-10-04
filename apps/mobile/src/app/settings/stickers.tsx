import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, RefreshCw, Search, Star, Sticker } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, FOREGROUND, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { segment, well } from '@/lib/depth';
import { getSessionToken } from '@/lib/session-token';
import {
  isSameOriginStickerUrl,
  stickerImageSource,
  type StickerItem,
  type StickerPack,
} from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { movedOrder, panelIdSet } from '@/components/stickers/order';
import { SettingsScreenShell } from '@/components/settings/screen-shell';

type StickerTab = 'packs' | 'discover' | 'favorites';

const TABS: readonly { key: StickerTab; label: string }[] = [
  { key: 'packs', label: 'My packs' },
  { key: 'discover', label: 'Discover' },
  { key: 'favorites', label: 'Favorites' },
];

type PageStatus = 'loading' | 'ready' | 'error';

const LOAD_ERROR = 'Could not load your stickers.';
const DISCOVER_ERROR = 'Could not load shared packs.';
const ADD_ERROR = 'Could not add the pack. Try again.';
const REMOVE_MODAL_ERROR = 'Could not remove the pack. Try again.';
const REORDER_ERROR = 'Could not reorder your packs. Try again.';
const FAVORITE_ERROR = 'Could not remove the favorite. Try again.';

/**
 * Settings → Stickers (T-0187, the mobile twin of web's `StickersPage`):
 * the panel packs in order with Remove and move up/down, the shared
 * Discover packs with search and Add, and the starred Favorites grid.
 * No pack editor and no Telegram import (T-0191).
 */
export default function StickersScreen() {
  return (
    <RequireStickersAuth>
      <StickersBody />
    </RequireStickersAuth>
  );
}

/** The tile size of the favorites grid: 4 columns inside the shell padding. */
export function favoriteTileSize(windowWidth: number): number {
  return Math.floor((windowWidth - 32 - 24) / 4);
}

function packCountLabel(count: number): string {
  return count === 1 ? '1 sticker' : `${count} stickers`;
}

function StickersBody() {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
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
  const [token, setToken] = useState<string | undefined>(undefined);
  const discoverLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getSessionToken().then((value) => {
      if (!cancelled) {
        setToken(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setActionError('');
    void Promise.all([api.listStickerPacks(), api.listStickerFavorites()])
      .then(([panel, starred]) => {
        setPacks(panel);
        setFavorites(starred);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      });
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
      void api
        .discoverStickerPacks(search)
        .then((page) => {
          setDiscover(page.packs);
          discoverLoaded.current = true;
        })
        .catch(() => {
          setDiscoverError(DISCOVER_ERROR);
        })
        .finally(() => {
          setDiscoverBusy(false);
        });
    },
    [api],
  );

  const openTab = (next: StickerTab): void => {
    setTab(next);
    if (next === 'discover' && !discoverLoaded.current && !discoverBusy) {
      loadDiscover('');
    }
  };

  const run = (id: string, task: () => Promise<void>, fallback: string): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyId(id);
    setActionError('');
    void task()
      .catch(() => {
        setActionError(fallback);
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(null);
      });
  };

  const refreshPanel = (): Promise<void> =>
    api.listStickerPacks().then((panel) => {
      setPacks(panel);
    });

  const addPack = (packId: string): void => {
    run(
      packId,
      () =>
        api.addStickerPanelPack(packId).then(() => {
          setDiscover((previous) =>
            previous === undefined ? previous : previous.map((row) => ({ ...row })),
          );
          return refreshPanel();
        }),
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
    void api
      .removeStickerPanelPack(packId)
      .then(() => refreshPanel())
      .then(() => setConfirming(null))
      .catch(() => {
        setConfirmError(REMOVE_MODAL_ERROR);
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(null);
      });
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
    void api
      .reorderStickerPanelPacks(next)
      .catch(() => {
        setPacks(previous);
        setActionError(REORDER_ERROR);
      })
      .finally(() => {
        busyRef.current = false;
        setBusyId(null);
      });
  };

  const unstar = (stickerId: string): void => {
    run(
      stickerId,
      () =>
        api.removeStickerFavorite(stickerId).then(() => {
          setFavorites((previous) => previous.filter((row) => row.id !== stickerId));
        }),
      FAVORITE_ERROR,
    );
  };

  const busy = busyId !== null;
  const panelIds = panelIdSet(packs.map((pack) => pack.id));
  const tile = favoriteTileSize(windowWidth);

  return (
    <SettingsScreenShell
      title="Stickers"
      subtitle="Your packs, shared packs and favorites."
      onBack={() => router.back()}
    >
      <View className="gap-4">
        <View
          className="mb-2 flex-row gap-0.5 rounded-[10px] p-[3px]"
          style={[well, { borderColor: '#1a1a1a' }]}
        >
          {TABS.map((entry) => {
            const selected = entry.key === tab;
            return (
              <Pressable
                key={`${entry.key}-${selected ? 'on' : 'off'}`}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={entry.label}
                onPress={() => openTab(entry.key)}
                className="h-[34px] flex-1 items-center justify-center rounded-[7px]"
                style={selected ? segment : undefined}
              >
                <Text
                  className={cn(
                    'text-[13px] font-medium',
                    selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {entry.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {status === 'loading' ? (
          <View className="items-center gap-3 pt-16">
            <ActivityIndicator color={ACCENT[scheme]} />
            <Text className="text-[15px] text-muted-foreground">Loading stickers…</Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View className="items-center gap-3 pt-12">
            <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
              {LOAD_ERROR}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading stickers"
              onPress={reload}
              className="flex-row items-center gap-2 rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
            >
              <RefreshCw size={16} color={ICON[scheme]} />
              <Text className="text-[15px] text-foreground">Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {status === 'ready' && tab === 'packs' ? (
          <View className="gap-2">
            <Text className="text-[16px] font-semibold text-foreground">My packs</Text>
            {actionError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {actionError}
              </Text>
            ) : null}
            {packs.length === 0 ? (
              <View className="items-center gap-3 pt-16">
                <Sticker size={32} color={ICON[scheme]} />
                <Text className="px-4 text-center text-[15px] text-muted-foreground">
                  No packs on your panel yet. Look in Discover for shared packs to add.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open Discover"
                  onPress={() => openTab('discover')}
                  className="rounded-full bg-accent px-5 py-2 active:opacity-90"
                >
                  <Text className="text-[15px] font-medium text-accent-foreground">
                    Open Discover
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-2">
                {packs.map((pack, index) => (
                  <PackCard key={pack.id} pack={pack} token={token}>
                    <View className="mt-2 flex-row items-center justify-between border-t border-divider pt-2">
                      <View className="flex-row gap-1">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${pack.title} up`}
                          disabled={busy || index === 0}
                          hitSlop={4}
                          onPress={() => movePack(pack.id, -1)}
                          className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised disabled:opacity-40"
                        >
                          <ChevronUp size={20} color={ICON[scheme]} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${pack.title} down`}
                          disabled={busy || index === packs.length - 1}
                          hitSlop={4}
                          onPress={() => movePack(pack.id, 1)}
                          className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised disabled:opacity-40"
                        >
                          <ChevronDown size={20} color={ICON[scheme]} />
                        </Pressable>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${pack.title}`}
                        disabled={busy}
                        onPress={() => askRemove(pack)}
                        className="rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-60"
                      >
                        <Text className="text-[14px] text-foreground">Remove</Text>
                      </Pressable>
                    </View>
                  </PackCard>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {status === 'ready' && tab === 'discover' ? (
          <View className="gap-2">
            <Text className="text-[14px] text-muted-foreground">
              Find shared packs from anyone on this server and add them to your panel.
            </Text>
            <View className="h-10 flex-row items-center gap-2 rounded-xl px-3" style={well}>
              <Search size={16} color={MUTED_FOREGROUND[scheme]} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => loadDiscover(query)}
                maxLength={60}
                returnKeyType="search"
                placeholder="Search shared packs"
                placeholderTextColor={MUTED_FOREGROUND[scheme]}
                accessibilityLabel="Search sticker packs"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 text-[15px] text-foreground"
              />
            </View>
            {actionError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {actionError}
              </Text>
            ) : null}
            {discoverBusy ? (
              <View className="items-center gap-3 pt-16">
                <ActivityIndicator color={ACCENT[scheme]} />
                <Text className="text-[15px] text-muted-foreground">Searching…</Text>
              </View>
            ) : discover === undefined || discoverError !== '' ? (
              <View className="items-center gap-3 pt-12">
                <Text accessibilityRole="alert" className="text-center text-[15px] text-danger">
                  {discoverError === '' ? DISCOVER_ERROR : discoverError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading shared packs"
                  onPress={() => loadDiscover(query)}
                  className="flex-row items-center gap-2 rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
                >
                  <RefreshCw size={16} color={ICON[scheme]} />
                  <Text className="text-[15px] text-foreground">Retry</Text>
                </Pressable>
              </View>
            ) : discover.length === 0 ? (
              <View className="items-center px-6 pt-12">
                <Text className="text-center text-[15px] text-muted-foreground">
                  No shared packs found. Try another search.
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {discover.map((pack) => {
                  const added = panelIds.has(pack.id);
                  return (
                    <PackCard
                      key={pack.id}
                      pack={pack}
                      token={token}
                      action={
                        added ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${pack.title}`}
                            disabled={busy}
                            onPress={() => askRemove(pack)}
                            className="shrink-0 rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-60"
                          >
                            <Text className="text-[14px] text-foreground">Remove</Text>
                          </Pressable>
                        ) : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${pack.title}`}
                            disabled={busy}
                            onPress={() => addPack(pack.id)}
                            className="shrink-0 rounded-full bg-accent px-3 py-1 active:opacity-90 disabled:opacity-60"
                          >
                            <Text className="text-[14px] font-medium text-accent-foreground">
                              {busyId === pack.id ? 'Adding…' : 'Add'}
                            </Text>
                          </Pressable>
                        )
                      }
                    />
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {status === 'ready' && tab === 'favorites' ? (
          <View className="gap-2">
            <Text className="text-[16px] font-semibold text-foreground">Favorites</Text>
            {actionError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {actionError}
              </Text>
            ) : null}
            {favorites.length === 0 ? (
              <View className="items-center px-6 pt-12">
                <Text className="text-center text-[15px] text-muted-foreground">
                  No favorites yet. Starred stickers show up here.
                </Text>
              </View>
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
                        resizeMode="contain"
                      />
                    ) : (
                      <Text accessibilityLabel={sticker.emoji ?? 'Sticker'}>
                        {sticker.emoji ?? ''}
                      </Text>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove favorite"
                      disabled={busy}
                      hitSlop={10}
                      onPress={() => unstar(sticker.id)}
                      className="absolute right-0.5 top-0.5 h-6 w-6 items-center justify-center rounded-full bg-black/70 active:opacity-70 disabled:opacity-60"
                    >
                      <Star size={12} color={FOREGROUND[scheme]} fill={FOREGROUND[scheme]} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
      </View>

      <Modal
        visible={confirming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirming(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 p-6">
          <View className="w-full max-w-xs rounded-2xl bg-background p-4">
            <Text className="text-[16px] font-semibold text-foreground">Remove this pack?</Text>
            <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
              {confirming === null
                ? ''
                : `${confirming.title} leaves your sticker panel. You can add it again from Discover if it is still shared.`}
            </Text>
            {confirmError !== '' ? (
              <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">
                {confirmError}
              </Text>
            ) : null}
            <View className="mt-4 flex-row justify-end gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                disabled={busy}
                onPress={() => setConfirming(null)}
                className="rounded-full px-3 py-1.5 active:bg-surface-raised disabled:opacity-60"
              >
                <Text className="text-[14px] text-muted-foreground">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  confirming === null ? 'Remove pack' : `Remove ${confirming.title}`
                }
                disabled={busy}
                onPress={confirmRemove}
                className="rounded-full bg-destructive px-3 py-1.5 active:opacity-90 disabled:opacity-60"
              >
                <Text className="text-[14px] font-medium text-white">
                  {busy ? 'Removing…' : 'Remove'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SettingsScreenShell>
  );
}

/** One pack row: the thumbnail strip, the title and count, and the action. */
function PackCard({
  pack,
  token,
  action,
  children,
}: {
  pack: StickerPack;
  token: string | undefined;
  /** Discover rows pass Add/Remove here; My packs rows render none (brief §3). */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const thumbs = pack.stickers.slice(0, 3);
  return (
    <View className="gap-1 rounded-xl border border-border bg-surface px-3 py-2.5">
      <View className="flex-row items-center gap-3">
        <View accessibilityElementsHidden className="flex-row">
          {thumbs.length === 0 ? (
            <View className="h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-raised">
              <Sticker size={18} color={MUTED_FOREGROUND[scheme]} />
            </View>
          ) : (
            thumbs.map((sticker, index) => (
              <View
                key={sticker.id}
                className={cn(
                  'h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-surface-raised',
                  index === 0 ? '' : '-ml-2',
                )}
              >
                {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                  <Image
                    source={stickerImageSource(sticker.url, API_URL, token)}
                    style={{ width: 28, height: 28 }}
                    resizeMode="contain"
                  />
                ) : null}
              </View>
            ))
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
            {pack.title}
          </Text>
          <Text className="text-[13px] text-muted-foreground">
            {packCountLabel(pack.stickers.length)}
          </Text>
        </View>
        {action === undefined ? null : <View className="shrink-0">{action}</View>}
      </View>
      {children}
    </View>
  );
}
