import { Film, Smile, Sticker as StickerIcon, type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { SegmentedControl } from '@/components/ui/segmented-control';
import type { EmojiCategoryId } from '@/lib/emoji-data';
import type { GifItem } from '@/lib/gifs';
import type { GifsApi } from '@/lib/gifs-api';
import type { RecentStickerEntry, StickerChoice, StickerPack } from '@/lib/stickers';
import { EmojiTab } from '@/components/chat/emoji-tab';
import { GifPanel } from '@/components/chat/gif-panel';
import { StickerGrid, type StickerPanelState } from '@/components/chat/sticker-panel';

const PANEL_HEIGHT = 320;

export type EmojiSheetTab = 'emoji' | 'stickers' | 'gifs';

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
  tab: EmojiSheetTab | undefined;
  onSelectTab: (tab: EmojiSheetTab) => void;
  gifsVisible: boolean;
  emojiRecents: readonly string[];
  emojiCategory: EmojiCategoryId | 'recent' | undefined;
  onSelectEmojiCategory: (category: EmojiCategoryId | 'recent' | undefined) => void;
  onPickEmoji: (emoji: string) => void;
  packs: StickerPack[] | undefined;
  panelState: StickerPanelState;
  stickerRecents: RecentStickerEntry[];
  activePackId: string | undefined;
  onSelectPack: (packId: string | undefined) => void;
  onPickSticker: (sticker: StickerChoice) => void;
  onRetryStickers: () => void;
  gifsApi?: GifsApi | undefined;
  onPickGif: (gif: GifItem) => void;
};

export function EmojiSheet({ open, ...props }: EmojiSheetProps) {
  if (!open) {
    return null;
  }
  return <EmojiSheetBody open={open} {...props} />;
}

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
}: EmojiSheetProps) {
  const visible: EmojiSheetTab = resolveSheetTab(tab, gifsVisible);
  const tabs: { id: EmojiSheetTab; label: string; icon: LucideIcon }[] = [
    { id: 'emoji', label: 'Emoji', icon: Smile },
    { id: 'stickers', label: 'Stickers', icon: StickerIcon },
    ...(gifsVisible ? [{ id: 'gifs' as const, label: 'GIFs', icon: Film }] : []),
  ];
  return (
    <View
      accessibilityRole="menu"
      accessibilityLabel="Emoji, stickers and GIFs"
      className="mt-1.5 border-t border-border bg-surface px-3 pt-2"
      style={{ height: PANEL_HEIGHT }}
    >
      <View className="pb-2">
        <SegmentedControl
          accessibilityLabel="Panel tabs"
          options={tabs.map((item) => ({
            value: item.id,
            label: item.label,
            icon: item.icon,
          }))}
          value={visible}
          onChange={(value) => {
            const next = tabs.find((item) => item.id === value);
            if (next !== undefined) {
              onSelectTab(next.id);
            }
          }}
        />
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
    </View>
  );
}
