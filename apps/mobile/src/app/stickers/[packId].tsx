import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Copy, Globe, Link as LinkIcon, Plus, Share2, Sticker } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RequireStickersAuth } from '@/components/stickers/require-stickers-auth';
import { favoriteTileSize, packCountLabel } from '@/components/stickers/tile-size';
import { useStickersApi } from '@/components/stickers/use-stickers-api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { Toast, type ToastMessage } from '@/components/ui/toast';
import { API_URL } from '@/lib/auth';
import { ACCENT_FOREGROUND, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { fromApi } from '@/lib/effect/api-effect';
import { interruptFiber } from '@/lib/effect/timers';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { goBackOrHome } from '@/lib/navigation';
import { getSessionToken } from '@/lib/session-token';
import {
  isSameOriginStickerUrl,
  stickerImageSource,
  stickerPackUrl,
  stickerPackUrlText,
} from '@/lib/stickers';

const NOT_AVAILABLE = 'This sticker pack is not available.';
const LOAD_ERROR = 'Could not load the pack.';
const ADD_ERROR = 'Could not add the pack. Try again.';
const REMOVE_ERROR = 'Could not remove the pack. Try again.';

/**
 * Anyone signed in who has the link may open and add the pack, so an unknown pack and someone else's imported pack answer the same "not available".
 */
export default function StickerPackLinkScreen() {
  return (
    <RequireStickersAuth>
      <StickerPackLinkBody />
    </RequireStickersAuth>
  );
}

function StickerPackLinkBody() {
  const router = useRouter();
  const params = useLocalSearchParams<{ packId?: string }>();
  const packId = typeof params.packId === 'string' ? params.packId : '';
  const { api } = useStickersApi();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const tile = favoriteTileSize(windowWidth);

  const [packState, reloadPack] = useQuery(
    () => fromApi(() => api.getStickerPack(packId)),
    [api, packId],
  );
  // The in-panel state the Add/Remove key switches locally before the refetch; it records the pack it applies to, so a link to another pack ignores it.
  const [panelOverride, setPanelOverride] = useState<
    { packId: string; inPanel: boolean } | undefined
  >(undefined);
  const [actionError, setActionError] = useState('');
  const [token, setToken] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.promise(() => getSessionToken()).pipe(
        Effect.tap((value) => Effect.sync(() => setToken(value))),
      ),
    );
    return () => {
      interruptFiber(fiber);
    };
  }, []);

  const pack = AsyncResult.isSuccess(packState) ? packState.value : undefined;
  const failure = isWaiting(packState) ? undefined : failureOf(packState);
  const loading = pack === undefined && failure === undefined;
  const inPanel =
    panelOverride?.packId === packId ? panelOverride.inPanel : (pack?.inPanel ?? false);

  const showToast = (text: string, tone: 'error' | 'notice'): void => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone });
  };

  const [addState, runAdd] = useAction<void, void, never>(() =>
    Effect.sync(() => setActionError('')).pipe(
      Effect.andThen(fromApi(() => api.addStickerPanelPack(packId))),
      Effect.tap(() => Effect.sync(() => setPanelOverride({ packId, inPanel: true }))),
      Effect.catch(() => Effect.sync(() => setActionError(ADD_ERROR))),
    ),
  );
  const [removeState, runRemove] = useAction<void, void, never>(() =>
    Effect.sync(() => setActionError('')).pipe(
      Effect.andThen(fromApi(() => api.removeStickerPanelPack(packId))),
      Effect.tap(() => Effect.sync(() => setPanelOverride({ packId, inPanel: false }))),
      Effect.catch(() => Effect.sync(() => setActionError(REMOVE_ERROR))),
    ),
  );
  const busy = isWaiting(addState) || isWaiting(removeState);

  const [, share] = useAction<void, void, never>(() =>
    Effect.tryPromise({
      try: () => Share.share({ message: stickerPackUrl(packId) }),
      catch: (cause) => cause,
    }).pipe(Effect.ignore),
  );

  const copyLink = (): void => {
    Effect.runFork(
      Effect.tryPromise({
        try: () => import('expo-clipboard'),
        catch: (cause) => cause,
      }).pipe(
        Effect.flatMap((Clipboard) =>
          Effect.tryPromise({
            try: () => Clipboard.setStringAsync(stickerPackUrl(packId)),
            catch: (cause) => cause,
          }),
        ),
        Effect.tap(() => Effect.sync(() => showToast('Link copied', 'notice'))),
        Effect.ignore,
      ),
    );
  };

  const count = pack?.stickers.length ?? 0;
  const meta =
    pack === undefined
      ? ''
      : `${packCountLabel(count)}${pack.ownerHandle === null ? '' : ` · @${pack.ownerHandle}`}`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader
        variant="sub"
        bare
        title={pack?.title ?? ''}
        onBack={() => goBackOrHome(router)}
        right={
          pack !== undefined ? (
            <IconButton label={`Share ${pack.title}`} onPress={() => share()}>
              <Share2 size={20} color={ICON} />
            </IconButton>
          ) : undefined
        }
      />

      {loading ? <StateMessage kind="loading" title="Loading…" /> : null}

      {failure !== undefined && failure.status === 404 ? (
        <StateMessage
          kind="error"
          title={NOT_AVAILABLE}
          action={{ label: 'Back', onPress: () => goBackOrHome(router) }}
        />
      ) : null}

      {failure !== undefined && failure.status !== 404 ? (
        <StateMessage
          kind="error"
          title={LOAD_ERROR}
          action={{ label: 'Retry', onPress: reloadPack }}
        />
      ) : null}

      {pack !== undefined ? (
        <>
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 16 }}>
            <View className="px-4 pt-1">
              <Text
                numberOfLines={2}
                className="text-[28px] font-semibold leading-9 text-foreground"
              >
                {pack.title}
              </Text>
              <View className="mb-3.5 mt-1 flex-row items-center gap-2">
                <Text className="text-[14px] text-muted-foreground">{meta}</Text>
                {pack.visibility === 'server' ? (
                  <Globe size={14} color={MUTED_FOREGROUND} accessibilityLabel="Shared" />
                ) : null}
              </View>

              <View className="h-11 flex-row items-center gap-2 rounded-xl border border-divider bg-well pl-3 pr-1">
                <LinkIcon size={16} color={MUTED_FOREGROUND} />
                <Text
                  numberOfLines={1}
                  className="min-w-0 flex-1 font-mono text-[13px] text-foreground"
                >
                  {stickerPackUrlText(pack.id)}
                </Text>
                <IconButton label="Copy link" className="h-9 w-9 rounded-[10px]" onPress={copyLink}>
                  <Copy size={15} color={ICON} />
                </IconButton>
              </View>

              <View
                accessibilityLabel={`Stickers in ${pack.title}`}
                className="mt-4 flex-row flex-wrap gap-2"
              >
                {pack.stickers.map((sticker) => (
                  <View
                    key={sticker.id}
                    className="items-center justify-center overflow-hidden rounded-[14px] bg-surface-raised"
                    style={{ width: tile, height: tile }}
                  >
                    {isSameOriginStickerUrl(sticker.url, API_URL) ? (
                      <Image
                        source={stickerImageSource(sticker.url, API_URL, token)}
                        style={{ width: tile, height: tile }}
                        contentFit="contain"
                      />
                    ) : (
                      <Sticker size={Math.round(tile / 2)} color={MUTED_FOREGROUND} />
                    )}
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View
            className="gap-2 border-t border-divider px-4 pt-3"
            style={{ paddingBottom: 12 + insets.bottom }}
          >
            {actionError !== '' ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {actionError}
              </Text>
            ) : null}
            {inPanel ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                accessibilityLabel="Remove from my stickers"
                disabled={busy}
                onPress={() => runRemove()}
              >
                <Text>{busy ? 'Removing…' : 'Remove from my stickers'}</Text>
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full"
                accessibilityLabel="Add to my stickers"
                disabled={busy}
                onPress={() => runAdd()}
              >
                <Plus size={18} color={ACCENT_FOREGROUND} />
                <Text>{busy ? 'Adding…' : 'Add to my stickers'}</Text>
              </Button>
            )}
          </View>
        </>
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </SafeAreaView>
  );
}
