import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';

/**
 * The new-message box (T-0190): the web `NewChatButton` "New message" dialog
 * sentence. The chat list already has the `Search, or type @username` search
 * bar, so the sentence is true on the phone. Same structure and classes as the
 * placeholder it replaces.
 */
export function NewMessageSheet({
  onInvite,
  onClose,
}: {
  onInvite: () => void;
  onClose: () => void;
}) {
  return (
    <Pressable
      onPress={() => {}}
      className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4"
    >
      <Text className="text-[16px] font-semibold text-foreground">New message</Text>
      <Text className="mt-1 text-[15px] text-muted-foreground">
        Invite a friend to start a conversation, or type their @username in the search bar above.
      </Text>
      <View className="mt-4 flex-row justify-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="rounded-full px-4 py-2 active:bg-surface-raised"
        >
          <Text className="text-[15px] text-muted-foreground">Close</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Invite a friend"
          onPress={onInvite}
          className="rounded-full bg-accent px-4 py-2 active:opacity-90"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">Invite a friend</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
