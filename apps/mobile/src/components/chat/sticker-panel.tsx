import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import {
  isSameOriginStickerUrl,
  recentChoiceFor,
  rememberRecentSticker,
  resolveActivePackId,
  stickerImageSource,
  type RecentStickerEntry,
  type StickerChoice,
  type StickerItem,
  type StickerPack,
} from '@/lib/stickers';
import { createStickersApi, type StickersApi } from '@/lib/stickers-api';

const CELL_SIZE = 72;

export type StickerPanelState = 'loading' | 'ready' | 'error' | 'empty';

/**
 * Whether the panel may show a thumbnail inline: same-origin file URLs
 * only. Anything else (a hostile URL planted in recents storage) shows the
 * emoji tile, so the device never fetches it.
 */
export function isPanelStickerUrl(url: string, apiUrl: string): boolean {
  return isSameOriginStickerUrl(url, apiUrl);
}

type StickerPanelProps = {
  open: boolean;
  packs: StickerPack[] | undefined;
  state: StickerPanelState;
  recents: RecentStickerEntry[];
  activePackId: string | undefined;
  onSelectPack: (packId: string | undefined) => void;
  onPick: (sticker: StickerChoice) => void;
  onRetry: () => void;
  onClose: () => void;
};

/**
 * The sticker panel bottom sheet (T-0143): a pack tab row (first: Recent), a
 * grid of stickers, tap-to-send. Pure view so it stays render-testable like
 * `PinsSheet`: the composer owns the packs load and the recents storage.
 */
export function StickerPanel({
  open,
  packs,
  state,
  recents,
  activePackId: activePackIdProp,
  onSelectPack,
  onPick,
  onRetry,
  onClose,
}: StickerPanelProps) {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void getSessionToken().then((value) => {
      if (!cancelled) {
        setToken(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) {
    return null;
  }
  const rows = packs ?? [];
  const activePackId = resolveActivePackId(activePackIdProp, rows, recents);
  const recentChoices: StickerChoice[] = recents.map(recentChoiceFor);
  const pack = rows.find((item) => item.id === activePackId);
  const choices: StickerChoice[] =
    activePackId === undefined
      ? recentChoices
      : (pack?.stickers.map((sticker) => ({
          stickerId: sticker.id,
          packId: sticker.packId,
          url: sticker.url,
          ...(sticker.emoji === null ? {} : { emoji: sticker.emoji }),
          width: sticker.width,
          height: sticker.height,
          mime: sticker.mime,
        })) ?? []);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close stickers"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="menu"
          accessibilityLabel="Stickers"
          className="max-h-[70%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            Stickers
          </Text>
          <View
            accessibilityRole="toolbar"
            accessibilityLabel="Sticker packs"
            className="flex-row gap-1 pb-2"
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Recent stickers"
              accessibilityState={{ selected: activePackId === undefined }}
              onPress={() => onSelectPack(undefined)}
              className="shrink-0 rounded-[8px] px-2.5 py-1 active:bg-surface-raised"
            >
              <Text className="text-[12px] text-foreground">Recent</Text>
            </Pressable>
            {rows.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`Sticker pack ${row.title}`}
                accessibilityState={{ selected: activePackId === row.id }}
                onPress={() => onSelectPack(row.id)}
                className="max-w-[120px] shrink-0 rounded-[8px] px-2.5 py-1 active:bg-surface-raised"
              >
                <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
                  {row.title}
                </Text>
              </Pressable>
            ))}
          </View>
          {state === 'loading' ? (
            <View className="h-[180px] items-center justify-center">
              <ActivityIndicator accessibilityLabel="Loading stickers" />
            </View>
          ) : state === 'error' ? (
            <View className="h-[180px] items-center justify-center gap-2 px-4">
              <Text className="text-center text-[13px] text-muted-foreground">
                Couldn't load stickers.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading stickers"
                onPress={onRetry}
                className="rounded-[10px] px-4 py-2 active:bg-surface-raised"
              >
                <Text className="text-[15px] font-semibold text-foreground">Retry</Text>
              </Pressable>
            </View>
          ) : rows.length === 0 && recentChoices.length === 0 ? (
            <View className="h-[180px] items-center justify-center px-4">
              <Text className="text-center text-[13px] text-muted-foreground">
                Create packs on the web for now
              </Text>
            </View>
          ) : choices.length === 0 ? (
            <View className="h-[180px] items-center justify-center px-4">
              <Text className="text-center text-[13px] text-muted-foreground">
                No stickers here yet.
              </Text>
            </View>
          ) : (
            <ScrollView
              accessibilityLabel="Stickers grid"
              className="shrink"
              contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap' }}
            >
              {choices.map((item) => (
                <Pressable
                  key={item.stickerId}
                  accessibilityRole="button"
                  accessibilityLabel={item.emoji ?? 'Sticker'}
                  onPress={() => onPick(item)}
                  className="items-center justify-center rounded-[8px] active:bg-surface-raised"
                  style={{ width: CELL_SIZE, height: CELL_SIZE }}
                >
                  <StickerThumb sticker={item} token={token} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A panel thumbnail: a same-origin file URL loads; anything else is emoji. */
function StickerThumb({ sticker, token }: { sticker: StickerChoice; token: string | undefined }) {
  const label = sticker.emoji ?? 'Sticker';
  if (!isPanelStickerUrl(sticker.url, API_URL)) {
    return (
      <Text accessibilityRole="image" accessibilityLabel={label} className="text-[26px]">
        {label === 'Sticker' ? '🙂' : label}
      </Text>
    );
  }
  return (
    <Image
      source={stickerImageSource(sticker.url, API_URL, token)}
      accessibilityLabel={label}
      style={{ width: 64, height: 64 }}
      resizeMode="contain"
    />
  );
}

export type RecentsStorage = {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
};

/**
 * Records a sent sticker in per-device recents (with its dimensions, so a
 * re-send from Recent puts the real size on the wire); a failing storage
 * never breaks sending.
 */
export async function persistRecent(
  storage: RecentsStorage,
  recents: readonly RecentStickerEntry[],
  sticker: StickerItem | RecentStickerEntry,
): Promise<RecentStickerEntry[]> {
  const entry: RecentStickerEntry = {
    stickerId: 'stickerId' in sticker ? sticker.stickerId : sticker.id,
    packId: sticker.packId,
    url: sticker.url,
    ...(sticker.emoji === undefined || sticker.emoji === null || sticker.emoji === ''
      ? {}
      : { emoji: sticker.emoji }),
    width: sticker.width,
    height: sticker.height,
    mime: sticker.mime,
  };
  const next = rememberRecentSticker(recents, entry);
  try {
    await storage.write(JSON.stringify(next));
  } catch {
    // A blocked storage must never break sending.
  }
  return next;
}

/** Loads the panel packs; throws so the sheet can show its error + Retry. */
export async function loadStickerPacks(api?: StickersApi): Promise<StickerPack[]> {
  const client = api ?? createStickersApi();
  return client.listStickerPacks();
}
