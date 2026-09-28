import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';

import type { PublicAi } from '../../lib/ais-api';

/** Bottom sheet opened by tapping an AI row: Open chat / Edit / Delete. */
export function AiActionsSheet({
  ai,
  onOpenChat,
  onEdit,
  onDelete,
  onClose,
}: {
  ai: PublicAi | null;
  onOpenChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={ai !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close AI actions"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
          {ai !== null ? (
            <View className="flex-row items-center gap-3 border-b border-divider px-4 py-3">
              <Avatar id={ai.id} name={ai.name} size={36} />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
                {ai.name}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat"
            onPress={onOpenChat}
            className="border-b border-divider px-4 py-3.5 active:bg-list-hover"
          >
            <Text className="text-[16px] text-foreground">Open chat</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit"
            onPress={onEdit}
            className="border-b border-divider px-4 py-3.5 active:bg-list-hover"
          >
            <Text className="text-[16px] text-foreground">Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete"
            onPress={onDelete}
            className="px-4 py-3.5 active:bg-list-hover"
          >
            <Text className="text-[16px] text-danger">Delete</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
