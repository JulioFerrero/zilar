import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';

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
        <Button variant="ghost" accessibilityLabel="Close" onPress={onClose}>
          <Text>Close</Text>
        </Button>
        <Button accessibilityLabel="Invite a friend" onPress={onInvite}>
          <Text>Invite a friend</Text>
        </Button>
      </View>
    </Pressable>
  );
}
