import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';

import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { personTarget, type PersonLinkRoute, type PersonTarget } from '@/lib/person-link';
import { useChatStore } from '@/store/chat-store-provider';

export function usePersonRoute(target: PersonTarget): PersonLinkRoute | undefined {
  const contacts = useChatStore((state) => state.contacts);
  const chats = useChatStore((state) => state.chats);
  const currentUserId = useChatStore((state) => state.currentUserId);
  return personTarget(target, { contacts, chats, currentUserId });
}

// Makes a person's avatar or name open them: a contact or an existing chat (my own AI) opens its DM, anyone else with a handle opens `/u/<handle>`. Myself and unknown people render the children alone.
export function PersonPressable({
  target,
  name,
  className,
  children,
}: {
  target: PersonTarget;
  name: string;
  className?: string;
  children: ReactNode;
}) {
  const route = usePersonRoute(target);
  // The link is an inner `Pressable`, so it swallows the bubble's `onLongPress`: forward the menu open, while a short tap opens the person.
  const openMenu = useOpenMessageMenu();
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  if (route === undefined) {
    return <>{children}</>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open ${name}`}
      hitSlop={6}
      onPress={() => router.push(route)}
      className={className}
      {...longPress}
    >
      {children}
    </Pressable>
  );
}
