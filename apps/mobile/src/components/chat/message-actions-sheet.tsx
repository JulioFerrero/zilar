import { Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type MessageActionsSheetProps = {
  visible: boolean;
  canCopy: boolean;
  onReply: () => void;
  onCopy: () => void;
  onClose: () => void;
};

/** Bottom sheet with Reply / Copy text / Delete, opened by a long press. */
export function MessageActionsSheet({
  visible,
  canCopy,
  onReply,
  onCopy,
  onClose,
}: MessageActionsSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close message menu"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          className="overflow-hidden rounded-t-2xl border-t border-border-strong bg-surface"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reply"
            onPress={onReply}
            className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
          >
            <Text className="text-[16px] text-foreground">Reply</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy text"
            disabled={!canCopy}
            onPress={onCopy}
            className={cn(
              'border-b border-divider px-4 py-3.5 active:bg-surface-raised',
              !canCopy && 'opacity-40',
            )}
          >
            <Text className="text-[16px] text-foreground">Copy text</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete"
            disabled
            className="px-4 py-3.5 opacity-40"
          >
            <Text className="text-[16px] text-danger">Delete</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
