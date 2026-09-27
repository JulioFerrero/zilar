import { SquarePen } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';

type NewChatAction = 'group' | 'message';

/** Round pencil button with a "New group" / "New message" menu. */
export function NewChatButton() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<NewChatAction | undefined>(undefined);

  const openDialog = (next: NewChatAction) => {
    setMenuOpen(false);
    setAction(next);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen(true)}
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-accent shadow-lg active:bg-accent/90"
      >
        <SquarePen size={24} color="#ffffff" />
      </Pressable>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          accessibilityLabel="Close new chat menu"
          onPress={() => setMenuOpen(false)}
          className="flex-1 justify-end bg-black/40 px-2 pb-4"
        >
          <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="New group"
              onPress={() => openDialog('group')}
              className="border-b border-divider px-4 py-3.5 active:bg-list-hover"
            >
              <Text className="text-[16px] text-foreground">New group</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="New message"
              onPress={() => openDialog('message')}
              className="px-4 py-3.5 active:bg-list-hover"
            >
              <Text className="text-[16px] text-foreground">New message</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={action !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setAction(undefined)}
      >
        <Pressable
          accessibilityLabel="Close dialog"
          onPress={() => setAction(undefined)}
          className="flex-1 items-center justify-center bg-black/40 p-4"
        >
          <Pressable onPress={() => {}} className="w-full max-w-xs rounded-2xl bg-background p-4">
            <Text className="text-[16px] font-semibold text-foreground">
              {action === 'group' ? 'New group' : 'New message'}
            </Text>
            <Text className="mt-1 text-[15px] text-muted-foreground">Coming soon</Text>
            <View className="mt-4 flex-row justify-end">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setAction(undefined)}
                className="rounded-full bg-accent px-4 py-1.5 active:bg-accent/90"
              >
                <Text className="text-[15px] font-medium text-accent-foreground">Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
