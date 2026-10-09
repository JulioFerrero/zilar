import { Effect, Fiber } from 'effect';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/ui/state-message';
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

/** The sticker grid columns (5 across the sheet, web parity). */
export const STICKER_GRID_COLUMNS = 5;

/** The gap between sticker cells and the sheet's side padding, in px. */
export const STICKER_GRID_GAP = 8;
export const STICKER_GRID_PADDING = 16;

/**
 * The sticker cell size for a sheet of the given width: 5 equal columns
 * with equal gaps and the sheet's side padding, so the grid has no uneven
 * gaps or crowded items (T-0175 addenda). The thumbnail breathes inside
 * its cell with a 4 px margin.
 */
export function stickerCellSize(sheetWidth: number): number {
  const usable =
    sheetWidth - STICKER_GRID_PADDING * 2 - STICKER_GRID_GAP * (STICKER_GRID_COLUMNS - 1);
  return Math.floor(usable / STICKER_GRID_COLUMNS);
}

/** The thumbnail size inside a sticker cell (a 4 px margin all around). */
export function stickerThumbSize(sheetWidth: number): number {
  return Math.max(stickerCellSize(sheetWidth) - 8, 24);
}

/** The fallback sheet width before the first `onLayout` measurement. */
export const DEFAULT_SHEET_WIDTH = 360;

export type StickerPanelState = 'loading' | 'ready' | 'error' | 'empty';

/**
 * Whether the panel may show a thumbnail inline: same-origin file URLs
 * only. Anything else (a hostile URL planted in recents storage) shows the
 * emoji tile, so the device never fetches it.
 */
export function isPanelStickerUrl(url: string, apiUrl: string): boolean {
  return isSameOriginStickerUrl(url, apiUrl);
}

/**
 * Runs an Effect for as long as the component's effect lasts: the returned
 * cleanup interrupts it, so a late answer never reaches an unmounted or
 * re-keyed view (the old `cancelled` flag).
 */
function runUntilCleanup(effect: Effect.Effect<void>): () => void {
  const fiber = Effect.runFork(effect);
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
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
 * The Stickers tab body (T-0175): the pack strip (Recent first) and the 5-column
 * grid with equal cells and equal gaps. Rendered inside `StickerPanel` and
 * inside the tabbed `EmojiSheet`; the session token loads here so both hosts
 * stay thin.
 */
export function StickerGrid({
  packs,
  state,
  recents,
  activePackId: activePackIdProp,
  onSelectPack,
  onPick,
  onRetry,
}: Omit<StickerPanelProps, 'open' | 'onClose'>) {
  const [token, setToken] = useState<string | undefined>(undefined);
  // The grid measures its sheet (`onLayout`) instead of reading the window:
  // inside the half-height sheet the window is wider than the content.
  const [sheetWidth, setSheetWidth] = useState(DEFAULT_SHEET_WIDTH);

  useEffect(
    () =>
      runUntilCleanup(
        Effect.tryPromise({ try: () => getSessionToken(), catch: (error) => error }).pipe(
          Effect.match({
            onFailure: () => undefined,
            onSuccess: (value) => setToken(value),
          }),
        ),
      ),
    [],
  );

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
  const cell = stickerCellSize(sheetWidth);
  const thumb = stickerThumbSize(sheetWidth);

  return (
    <View
      className="flex min-h-0 flex-1 flex-col"
      onLayout={(event) => setSheetWidth(Math.round(event.nativeEvent.layout.width))}
    >
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
          <StateMessage kind="loading" title="Loading stickers" />
        </View>
      ) : state === 'error' ? (
        <View className="h-[180px] items-center justify-center gap-2 px-4">
          <StateMessage
            kind="error"
            title="Couldn't load stickers."
            action={{
              label: 'Retry',
              accessibilityLabel: 'Retry loading stickers',
              onPress: onRetry,
            }}
          />
        </View>
      ) : rows.length === 0 && recentChoices.length === 0 ? (
        <View className="h-[180px] items-center justify-center px-4">
          <Text className="text-center text-[13px] text-muted-foreground">
            Create packs on the web for now
          </Text>
        </View>
      ) : choices.length === 0 ? (
        <View className="h-[180px] items-center justify-center px-4">
          <StateMessage kind="empty" title="No stickers here yet." />
        </View>
      ) : (
        <ScrollView
          accessibilityLabel="Stickers grid"
          className="min-h-0 flex-1"
          contentContainerStyle={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: STICKER_GRID_GAP,
            paddingHorizontal: STICKER_GRID_PADDING,
            paddingVertical: STICKER_GRID_GAP,
          }}
        >
          {choices.map((item) => (
            <Pressable
              key={item.stickerId}
              accessibilityRole="button"
              accessibilityLabel={item.emoji ?? 'Sticker'}
              onPress={() => onPick(item)}
              className="items-center justify-center rounded-[8px] active:bg-surface-raised"
              style={{ width: cell, height: cell }}
            >
              <StickerThumb sticker={item} token={token} size={thumb} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * The sticker panel bottom sheet (T-0143): a pack tab row (first: Recent), a
 * grid of stickers, tap-to-send. Pure view so it stays render-testable like
 * `PinsSheet`: the composer owns the packs load and the recents storage.
 * The body is `StickerGrid`, shared with the tabbed `EmojiSheet` (T-0175).
 */
export function StickerPanel({
  open,
  packs,
  state,
  recents,
  activePackId,
  onSelectPack,
  onPick,
  onRetry,
  onClose,
}: StickerPanelProps) {
  const insets = useSafeAreaInsets();

  if (!open) {
    return null;
  }
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
          className="h-[50%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            Stickers
          </Text>
          <StickerGrid
            packs={packs}
            state={state}
            recents={recents}
            activePackId={activePackId}
            onSelectPack={onSelectPack}
            onPick={onPick}
            onRetry={onRetry}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A panel thumbnail: a same-origin file URL loads; anything else is emoji. */
function StickerThumb({
  sticker,
  token,
  size,
}: {
  sticker: StickerChoice;
  token: string | undefined;
  size: number;
}) {
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
      style={{ width: size, height: size }}
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
export function persistRecent(
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
  // A blocked storage must never break sending: a failed write is dropped.
  const write = Effect.tryPromise({
    try: () => storage.write(JSON.stringify(next)),
    catch: (error) => error,
  }).pipe(
    Effect.catch(() => Effect.void),
    Effect.as(next),
  );
  return Effect.runPromise(write);
}

/** Loads the panel packs; throws so the sheet can show its error + Retry. */
export function loadStickerPacks(api?: StickersApi): Promise<StickerPack[]> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => (api ?? createStickersApi()).listStickerPacks(),
      catch: (error) => error,
    }),
  );
}
