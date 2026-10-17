import { Film, Smile, Sticker as StickerIcon } from 'lucide-react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Modal, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { EmojiCategoryId } from '@/lib/emoji-data';
import type { GifItem } from '@/lib/gifs';
import type { GifsApi } from '@/lib/gifs-api';
import type { RecentStickerEntry, StickerChoice, StickerPack } from '@/lib/stickers';
import { EmojiTab } from '@/components/chat/emoji-tab';
import { GifPanel } from '@/components/chat/gif-panel';
import { useSheetMotion } from '@/components/chat/sheet-motion';
import { StickerGrid, type StickerPanelState } from '@/components/chat/sticker-panel';

/** The sheet tabs, in display order (Emoji first, selected by default). */
export type EmojiSheetTab = 'emoji' | 'stickers' | 'gifs';

/**
 * Which tab the sheet shows: the remembered one while it is still visible,
 * else the first visible one — so the sheet never shows an empty body when
 * the GIFs tab disappears under the active tab.
 */
export function resolveSheetTab(
  remembered: EmojiSheetTab | undefined,
  gifsVisible: boolean,
): EmojiSheetTab {
  if (remembered === 'gifs' && !gifsVisible) {
    return 'emoji';
  }
  return remembered ?? 'emoji';
}

type EmojiSheetProps = {
  open: boolean;
  /** The session-remembered tab; the composer owns it. */
  tab: EmojiSheetTab | undefined;
  onSelectTab: (tab: EmojiSheetTab) => void;
  /** GIFs tab hidden when the provider is off (the composer probes). */
  gifsVisible: boolean;
  /** Emoji tab. */
  emojiRecents: readonly string[];
  emojiCategory: EmojiCategoryId | 'recent' | undefined;
  onSelectEmojiCategory: (category: EmojiCategoryId | 'recent' | undefined) => void;
  onPickEmoji: (emoji: string) => void;
  /** Stickers tab (the same packs/recents state the composer owns). */
  packs: StickerPack[] | undefined;
  panelState: StickerPanelState;
  stickerRecents: RecentStickerEntry[];
  activePackId: string | undefined;
  onSelectPack: (packId: string | undefined) => void;
  onPickSticker: (sticker: StickerChoice) => void;
  onRetryStickers: () => void;
  /** GIFs tab. */
  gifsApi?: GifsApi | undefined;
  onPickGif: (gif: GifItem) => void;
  onClose: () => void;
};

/**
 * The one emoji sheet (T-0175): tabs Emoji | Stickers | GIFs above the
 * bodies the separate sheets showed before. The sheet takes about half of
 * the screen height and never hides the composer's current line; on Android
 * with the keyboard open it replaces the keyboard (the composer dismisses
 * it when the sheet opens). T-1669 wraps the sheet in a keyboard-avoiding
 * view: while a search field is focused, the panel rises above the keyboard
 * and shrinks with it, so the results stay visible. Back button and
 * tap-outside close it, as the other sheets do. Lucide icons for the tabs;
 * emoji characters only as emoji content.
 */
export function EmojiSheet({ open, ...props }: EmojiSheetProps) {
  if (!open) {
    return null;
  }
  return <EmojiSheetBody open={open} {...props} />;
}

/**
 * The open sheet's body. Split out so closing unmounts it, restarting the
 * panel's slide on the next open (hooks cannot run after the early return).
 */
function EmojiSheetBody({
  open,
  tab,
  onSelectTab,
  gifsVisible,
  emojiRecents,
  emojiCategory,
  onSelectEmojiCategory,
  onPickEmoji,
  packs,
  panelState,
  stickerRecents,
  activePackId,
  onSelectPack,
  onPickSticker,
  onRetryStickers,
  gifsApi,
  onPickGif,
  onClose,
}: EmojiSheetProps) {
  const insets = useSafeAreaInsets();
  const iconColor = ICON;
  const { panelStyle, onLayout, close } = useSheetMotion(onClose);
  const visible: EmojiSheetTab = resolveSheetTab(tab, gifsVisible);
  const tabs: { id: EmojiSheetTab; label: string; icon: React.ReactNode }[] = [
    { id: 'emoji', label: 'Emoji', icon: <Smile size={16} color={iconColor} /> },
    { id: 'stickers', label: 'Stickers', icon: <StickerIcon size={16} color={iconColor} /> },
    ...(gifsVisible
      ? [{ id: 'gifs' as const, label: 'GIFs', icon: <Film size={16} color={iconColor} /> }]
      : []),
  ];
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable
          accessibilityLabel="Close emoji panel"
          onPress={close}
          className="flex-1 justify-end bg-black/40"
        >
          <Animated.View className="h-[50%]" onLayout={onLayout} style={panelStyle}>
            <Pressable
              onPress={() => {}}
              accessibilityRole="menu"
              accessibilityLabel="Emoji, stickers and GIFs"
              className="flex-1 rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
              style={{ paddingBottom: Math.max(insets.bottom, 8) }}
            >
              <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
              <View
                accessibilityRole="tablist"
                accessibilityLabel="Panel tabs"
                className="flex-row gap-1 pb-2"
              >
                {tabs.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: visible === item.id }}
                    onPress={() => onSelectTab(item.id)}
                    className="flex-row items-center gap-1.5 rounded-[8px] px-3 py-1.5 active:bg-surface-raised"
                  >
                    {item.icon}
                    <Text className="text-[13px] font-medium text-foreground">{item.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View className="min-h-0 flex-1">
                {visible === 'emoji' ? (
                  <EmojiTab
                    open={open}
                    recents={emojiRecents}
                    activeCategory={emojiCategory}
                    onSelectCategory={onSelectEmojiCategory}
                    onPick={onPickEmoji}
                  />
                ) : visible === 'stickers' ? (
                  <StickerGrid
                    packs={packs}
                    state={panelState}
                    recents={stickerRecents}
                    activePackId={activePackId}
                    onSelectPack={onSelectPack}
                    onPick={onPickSticker}
                    onRetry={onRetryStickers}
                  />
                ) : (
                  <GifPanel open={open} api={gifsApi} onPick={onPickGif} />
                )}
              </View>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
