import { formatListTime } from '@galena/chat-core';
import { VolumeX } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { Ticks } from '@/components/chat/ticks';
import { TypingDots } from '@/components/chat/typing-dots';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
import { previewParts, typingLabel } from '@/lib/format';
import { CURRENT_USER_ID, type ChatSummary, type MessageStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';
import { useColorScheme } from 'nativewind';

type ChatListItemProps = {
  chat: ChatSummary;
  onPress: () => void;
};

function UnreadBadge({ count, muted }: { count: number; muted: boolean }) {
  return (
    <View
      className={cn(
        'h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5',
        muted ? 'bg-badge-muted' : 'bg-accent',
      )}
    >
      <Text className="text-[12px] font-semibold text-accent-foreground">{count}</Text>
    </View>
  );
}

/** The 76 px chat row from ui-style.md §4. */
export function ChatListItem({ chat, onPress }: ChatListItemProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const last = chat.lastMessage;
  const typing = typingLabel(chat, names ?? []);
  const preview = previewParts(last, {
    isGroup: chat.kind === 'group',
    currentUserId: CURRENT_USER_ID,
  });
  const showTicks = chat.unread === 0 && last?.senderId === CURRENT_USER_ID;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      onPress={onPress}
      className="flex-row items-center bg-background pl-4 active:bg-list-hover"
      style={{ height: 76 }}
    >
      <Avatar id={chat.id} name={chat.title} size={54} online={chat.online} />
      <View className="ml-3 h-full flex-1 flex-row items-center border-b border-divider pr-4">
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-center">
              <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
                {chat.title}
              </Text>
              {chat.isAI ? <AiBadge className="ml-1.5" /> : null}
              {chat.muted ? (
                <View className="ml-4">
                  <VolumeX size={16} color={MUTED_FOREGROUND[scheme]} />
                </View>
              ) : null}
            </View>
            {last ? (
              <Text className="ml-2 text-[13px] text-muted-foreground">
                {formatListTime(last.createdAt, new Date())}
              </Text>
            ) : null}
          </View>
          <View className="mt-0.5 flex-row items-center justify-between">
            {typing !== undefined ? (
              <View className="mr-2 flex-1 flex-row items-center">
                <Text numberOfLines={1} className="text-[15px] text-accent">
                  {typing}
                </Text>
                <TypingDots color={ACCENT[scheme]} className="ml-0.5" />
              </View>
            ) : (
              <Text numberOfLines={1} className="mr-2 flex-1 text-[15px] text-muted-foreground">
                {preview.prefix ? <Text className="text-foreground">{preview.prefix}</Text> : null}
                {preview.body}
              </Text>
            )}
            {chat.unread > 0 ? (
              <UnreadBadge count={chat.unread} muted={chat.muted} />
            ) : showTicks && last ? (
              <Ticks
                status={last.status as MessageStatus}
                color={last.status === 'read' ? ACCENT[scheme] : MUTED_FOREGROUND[scheme]}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
