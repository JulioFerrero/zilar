import { Archive, Bell, BellOff, Pin, PinOff, type LucideIcon } from 'lucide-react-native';
import { useRef, type ReactNode, type RefObject } from 'react';
import { Pressable, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Text } from '@/components/ui/text';
import { MUTE_DURATIONS, mutedUntilFor } from '@/lib/chat-prefs';
import type { PutChatPrefInput } from '@/lib/chat-prefs-api';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { ChatSummary } from '@/lib/types';

// The swipe's mute uses the longest offered duration; the sheet offers the full choice.
const SWIPE_MUTE_ID = MUTE_DURATIONS.find((entry) => entry.id === 'forever')?.id ?? 'week';

type SwipeActionProps = {
  label: string;
  accessibilityLabel: string;
  icon: LucideIcon;
  onPress: () => void;
};

function SwipeAction({ label, accessibilityLabel, icon: Icon, onPress }: SwipeActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="min-w-[64px] items-center justify-center gap-1 bg-surface-raised px-2 active:opacity-70"
    >
      <Icon size={20} color={MUTED_FOREGROUND} />
      <Text className="text-[11px] text-muted-foreground">{label}</Text>
    </Pressable>
  );
}

type ChatRowSwipeProps = {
  chat: ChatSummary;
  onPref: (chatId: string, input: PutChatPrefInput) => void;
  openRef: RefObject<SwipeableMethods | null>;
  children: ReactNode;
};

export function ChatRowSwipe({ chat, onPref, openRef, children }: ChatRowSwipeProps) {
  const ownRef = useRef<SwipeableMethods>(null);

  const act = (input: PutChatPrefInput) => {
    ownRef.current?.close();
    onPref(chat.id, input);
  };

  const pinned = chat.pinnedAt !== undefined;
  const muted = chat.muted === true;
  const archived = chat.archived === true;

  return (
    <Swipeable
      ref={ownRef}
      renderRightActions={() => (
        <View className="flex-row items-stretch">
          <SwipeAction
            label={pinned ? 'Unpin' : 'Pin'}
            accessibilityLabel={pinned ? 'Unpin chat' : 'Pin chat'}
            icon={pinned ? PinOff : Pin}
            onPress={() => act({ pinned: chat.pinnedAt === undefined })}
          />
          <SwipeAction
            label={muted ? 'Unmute' : 'Mute'}
            accessibilityLabel={muted ? 'Unmute chat' : 'Mute chat'}
            icon={muted ? BellOff : Bell}
            onPress={() =>
              act(
                muted
                  ? { mutedUntil: null }
                  : { mutedUntil: mutedUntilFor(SWIPE_MUTE_ID, new Date()) },
              )
            }
          />
          <SwipeAction
            label={archived ? 'Unarchive' : 'Archive'}
            accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
            icon={Archive}
            onPress={() => act({ archived: chat.archived !== true })}
          />
        </View>
      )}
      onSwipeableWillOpen={() => {
        if (openRef.current !== null && openRef.current !== ownRef.current) {
          openRef.current.close();
        }
        openRef.current = ownRef.current;
      }}
    >
      {children}
    </Swipeable>
  );
}
