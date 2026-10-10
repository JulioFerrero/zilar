import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';

import { GifPanel, type GifPanelProps } from './gif-panel';

type GifSheetProps = GifPanelProps & {
  onClose: () => void;
};

/**
 * The GIF sheet wrapper (the composer renders it next to `StickerPanel`).
 * Kept in this file so the composer imports one GIF module, like stickers.
 */
export function GifSheet({ open, mockItems, api, onPick, onClose }: GifSheetProps) {
  const insets = useSafeAreaInsets();
  if (!open) {
    return null;
  }
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close GIFs"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="menu"
          accessibilityLabel="GIFs"
          className="h-[50%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            GIFs
          </Text>
          <GifPanel open={open} mockItems={mockItems} api={api} onPick={onPick} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
