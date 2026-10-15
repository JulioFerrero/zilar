import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

/**
 * The new-message box (T-0190): the web `NewChatButton` "New message" dialog
 * sentence. The chat list already has the `Search, or type @username` search
 * bar, so the sentence is true on the phone. On the kit bottom sheet (T-1451):
 * `Invite a friend` is the sticky footer's one primary and the header's close
 * key is the way out.
 */
export function NewMessageSheet({
  visible,
  onInvite,
  onClose,
}: {
  visible: boolean;
  onInvite: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close new message"
      title="New message"
      footer={
        <Button accessibilityLabel="Invite a friend" onPress={onInvite}>
          <Text>Invite a friend</Text>
        </Button>
      }
    >
      <Text className="mt-1 text-[15px] text-muted-foreground">
        Invite a friend to start a conversation, or type their @username in the search bar above.
      </Text>
    </BottomSheet>
  );
}
