import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { JoinLinkForm } from '@/components/chat/join-link';
import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { ACCENT_FOREGROUND, KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';

type NewChatAction = 'group' | 'message' | 'join';

/** The 56 px primary FAB with a "New group" / "New message" / "Join" menu. */
export function NewChatButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<NewChatAction | undefined>(undefined);

  const openDialog = (next: NewChatAction) => {
    setMenuOpen(false);
    setAction(next);
  };

  // Pastes a link in the menu: the form parses it locally and the app opens
  // the join screen with the token (the token never appears in any message).
  const joinWithToken = (token: string) => {
    setAction(undefined);
    router.push({ pathname: '/join/[token]', params: { token } });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen(true)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-[18px]"
        style={[
          primaryKey,
          pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion),
          { bottom: Math.max(insets.bottom, 20) + 14 },
        ]}
      >
        <Plus size={24} color={ACCENT_FOREGROUND} />
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
          <Pressable
            onPress={() => {}}
            className="overflow-hidden rounded-2xl border border-border-strong bg-surface"
          >
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="New group"
              onPress={() => openDialog('group')}
              className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-foreground">New group</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="New message"
              onPress={() => openDialog('message')}
              className="border-b border-divider px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-foreground">New message</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Join with a link"
              onPress={() => openDialog('join')}
              className="px-4 py-3.5 active:bg-surface-raised"
            >
              <Text className="text-[16px] text-foreground">Join with a link</Text>
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
          {action === 'join' ? (
            <JoinLinkForm onSubmit={joinWithToken} />
          ) : (
            <Pressable
              onPress={() => {}}
              className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4"
            >
              <Text className="text-[16px] font-semibold text-foreground">
                {action === 'group' ? 'New group' : 'New message'}
              </Text>
              <Text className="mt-1 text-[15px] text-muted-foreground">Coming soon</Text>
              <View className="mt-4 flex-row justify-end">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={() => setAction(undefined)}
                  className="rounded-full bg-accent px-4 py-1.5 active:opacity-90"
                >
                  <Text className="text-[15px] font-medium text-accent-foreground">Close</Text>
                </Pressable>
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </>
  );
}
