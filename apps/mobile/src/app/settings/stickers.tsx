import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Download, Pencil, Plus, Star, Sticker } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, View, useWindowDimensions } from 'react-native';
import { Effect, Fiber } from 'effect';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useAuthStore } from '@/auth/session';
import { API_URL } from '@/lib/auth';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT_FOREGROUND, FOREGROUND, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { getSessionToken } from '@/lib/session-token';
import {
  isSameOriginStickerUrl,
  stickerImageSource,
  type StickerItem,
  type StickerPack,
} from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { TelegramImportSheet } from '@/components/stickers/telegram-import-sheet';
import { movedOrder, panelIdSet } from '@/components/stickers/order';
import { SettingsScreenShell } from '@/components/settings/screen-shell';

type StickerTab = 'packs' | 'discover' | 'favorites';

const TABS: readonly { key: StickerTab; label: string }[] = [
  { key: 'packs', label: 'My packs' },
  { key: 'discover', label: 'Discover' },
  { key: 'favorites', label: 'Favorites' },
];

const isStickerTab = (value: string): value is StickerTab =>
  TABS.some((entry) => entry.key === value);

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
  const [importOpen, setImportOpen] = useState(false);
  // Remounts the import sheet on every open so earlier input, result and
  // error clear (brief §1).
  const [importNonce, setImportNonce] = useState(0);
  const [token, setToken] = useState<string | undefined>(undefined);
  const me = useAuthStore((state) => state.me);
  const discoverLoaded = useRef(false);

  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.promise(() => getSessionToken()).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            setToken(value);
          }),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setActionError('');
    Effect.runFork(
      Effect.all(
        [fromApi(() => api.listStickerPacks()), fromApi(() => api.listStickerFavorites())],
        {
          concurrency: 'unbounded',
        },
      ).pipe(
        Effect.tap(([panel, starred]) =>
          Effect.sync(() => {
            setPacks(panel);
            setFavorites(starred);
            setStatus('ready');
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setStatus('error');
          }),
        ),
      ),
    );
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
      Effect.runFork(
        fromApi(() => api.discoverStickerPacks(search)).pipe(
          Effect.tap((page) =>
            Effect.sync(() => {
              setDiscover(page.packs);
              discoverLoaded.current = true;
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              setDiscoverError(DISCOVER_ERROR);
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              setDiscoverBusy(false);
            }),
          ),
        ),
      );
    },
    [api],
  );

  const openTab = (next: StickerTab): void => {
    setTab(next);
    if (next === 'discover' && !discoverLoaded.current && !discoverBusy) {
      loadDiscover('');
    }
  };

  const run = (id: string, task: Effect.Effect<unknown, unknown>, fallback: string): void => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusyId(id);
    setActionError('');
    Effect.runFork(
      task.pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            setActionError(fallback);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusyId(null);
          }),
        ),
      ),
    );
  };

  const refreshPanel = fromApi(() => api.listStickerPacks()).pipe(
    Effect.tap((panel) =>
      Effect.sync(() => {
        setPacks(panel);
      }),
    ),
  );

  const addPack = (packId: string): void => {
    run(
      packId,
      fromApi(() => api.addStickerPanelPack(packId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setDiscover((previous) =>
              previous === undefined ? previous : previous.map((row) => ({ ...row })),
            );
          }),
        ),
        Effect.andThen(refreshPanel),
      ),
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
    Effect.runFork(
      fromApi(() => api.removeStickerPanelPack(packId)).pipe(
        Effect.andThen(refreshPanel),
        Effect.andThen(
          Effect.sync(() => {
            setConfirming(null);
          }),
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            setConfirmError(REMOVE_MODAL_ERROR);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusyId(null);
          }),
        ),
      ),
    );
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
    Effect.runFork(
      fromApi(() => api.reorderStickerPanelPacks(next)).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            setPacks(previous);
            setActionError(REORDER_ERROR);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusyId(null);
          }),
        ),
      ),
    );
  };

  const unstar = (stickerId: string): void => {
    run(
      stickerId,
      fromApi(() => api.removeStickerFavorite(stickerId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setFavorites((previous) => previous.filter((row) => row.id !== stickerId));
          }),
        ),
      ),
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
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-[16px] font-semibold text-foreground">My packs</Text>
              <Button
                variant="default"
                size="sm"
                accessibilityLabel="Create a new sticker pack"
                disabled={busy}
                onPress={() => router.push('/settings/sticker-pack')}
              >
                <Plus size={16} color={ACCENT_FOREGROUND[scheme]} />
                <Text>New pack</Text>
              </Button>
            </View>
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              accessibilityLabel="Import from Telegram"
              disabled={busy}
              onPress={() => {
                setImportNonce((nonce) => nonce + 1);
                setImportOpen(true);
              }}
            >
              <Download size={16} color={ICON[scheme]} />
              <Text className="text-[15px] text-foreground">Import from Telegram</Text>
            </Button>
            {actionError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {actionError}
              </Text>
            ) : null}
            {packs.length === 0 ? (
              <StateMessage
                kind="empty"
                icon={Sticker}
                title="No packs on your panel yet. Look in Discover for shared packs to add."
                action={{
                  label: 'Open Discover',
                  accessibilityLabel: 'Open Discover',
                  onPress: () => openTab('discover'),
                }}
              />
            ) : (
              <View className="gap-2">
                {packs.map((pack, index) => (
                  <PackCard key={pack.id} pack={pack} token={token} meId={me?.id}>
                    <View className="mt-2 flex-row items-center justify-between border-t border-divider pt-2">
                      <View className="flex-row gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-lg"
                          hitSlop={4}
                          accessibilityLabel={`Move ${pack.title} up`}
                          disabled={busy || index === 0}
                          onPress={() => movePack(pack.id, -1)}
                        >
                          <ChevronUp size={20} color={ICON[scheme]} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-lg"
                          hitSlop={4}
                          accessibilityLabel={`Move ${pack.title} down`}
                          disabled={busy || index === packs.length - 1}
                          onPress={() => movePack(pack.id, 1)}
                        >
                          <ChevronDown size={20} color={ICON[scheme]} />
                        </Button>
                      </View>
                      <View className="flex-row items-center gap-2">
                        {me !== null && pack.ownerId !== undefined && pack.ownerId === me.id ? (
                          <Button
                            variant="outline"
                            size="sm"
                            accessibilityLabel={`Edit ${pack.title}`}
                            disabled={busy}
                            onPress={() =>
                              router.push({
                                pathname: '/settings/sticker-pack',
                                params: { id: pack.id },
                              })
                            }
                          >
                            <Pencil size={14} color={ICON[scheme]} />
                            <Text>Edit</Text>
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          accessibilityLabel={`Remove ${pack.title}`}
                          disabled={busy}
                          onPress={() => askRemove(pack)}
                        >
                          <Text>Remove</Text>
                        </Button>
                      </View>
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
            <SearchField
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => loadDiscover(query)}
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
                  onPress: () => loadDiscover(query),
                }}
              />
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
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            accessibilityLabel={`Remove ${pack.title}`}
                            disabled={busy}
                            onPress={() => askRemove(pack)}
                          >
                            <Text>Remove</Text>
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            className="shrink-0"
                            accessibilityLabel={`Add ${pack.title}`}
                            disabled={busy}
                            onPress={() => addPack(pack.id)}
                          >
                            <Text>{busyId === pack.id ? 'Adding…' : 'Add'}</Text>
                          </Button>
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

/** One pack row: the thumbnail strip, the title and count, and the action. */
function PackCard({
  pack,
  token,
  action,
  children,
  meId,
}: {
  pack: StickerPack;
  token: string | undefined;
  /** Discover rows pass Add/Remove here; My packs rows render none (brief §3). */
  action?: React.ReactNode;
  children?: React.ReactNode;
  /** The signed-in user id: own packs get the subtitle and the Edit pill. */
  meId?: string | undefined;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const thumbs = pack.stickers.slice(0, 3);
  const own = meId !== undefined && pack.ownerId !== undefined && pack.ownerId === meId;
  const subtitle =
    own && pack.importedFrom !== undefined
      ? `${packCountLabel(pack.stickers.length)} · Imported`
      : own && pack.visibility === 'server'
        ? `${packCountLabel(pack.stickers.length)} · Shared`
        : own
          ? `${packCountLabel(pack.stickers.length)} · Private`
          : packCountLabel(pack.stickers.length);
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
          <Text className="text-[13px] text-muted-foreground">{subtitle}</Text>
        </View>
        {action === undefined ? null : <View className="shrink-0">{action}</View>}
      </View>
      {children}
    </View>
  );
}
