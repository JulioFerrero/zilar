import { formatListTime } from '@galena/chat-core';
import { VolumeX } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { plainPreviewBody } from '@/components/chat/markdown-decision';
import { Ticks } from '@/components/chat/ticks';
import { PulseDot } from '@/components/chat/typing-dots';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { primaryKey, raisedPill } from '@/lib/depth';
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
      style={muted ? raisedPill : primaryKey}
      className="h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5"
    >
      <Text
        className={cn(
          'text-[12px] font-semibold',
          muted ? 'text-foreground' : 'text-accent-foreground',
        )}
      >
        {count}
      </Text>
    </View>
  );
}

/** The 76 px chat row, restyled for D24 (ui-style.md §5). */
export function ChatListItem({ chat, onPress }: ChatListItemProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
  const last = chat.lastMessage;
  const typing = typingLabel(chat, names ?? []);
  const label = chat.isAI && (typing !== undefined || hasDraft) ? 'writing…' : typing;
  const preview = previewParts(last, {
    isGroup: chat.kind === 'group',
    currentUserId: CURRENT_USER_ID,
  });
  // An incoming AI reply (a DM AI or a group AI reply) previews as plain text; a
  // human message or your own stays literal.
  const body = plainPreviewBody(chat, last, preview.body, CURRENT_USER_ID);
  const showTicks = chat.unread === 0 && last?.senderId === CURRENT_USER_ID;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chat.title}
      onPress={onPress}
      className="h-[76px] flex-row items-center bg-background pl-4 active:bg-surface-raised"
    >
      <Avatar id={chat.id} name={chat.title} size={52} online={chat.online} ai={chat.isAI} />
      <View className="ml-3 h-full flex-1 flex-row items-center border-b border-[#1a1a1a] pr-4">
        <View className="flex-1 justify-center">
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1 flex-row items-center">
              <Text numberOfLines={1} className="text-[16px] font-semibold text-foreground">
                {chat.title}
              </Text>
              {chat.isAI ? <AiBadge className="ml-1.5" /> : null}
              {chat.muted ? (
                <View className="ml-2">
                  <VolumeX size={16} color={MUTED_FOREGROUND[scheme]} />
                </View>
              ) : null}
            </View>
            {last ? (
              <Text className="ml-2 shrink-0 font-mono text-[12px] text-subtle-foreground">
                {formatListTime(last.createdAt, new Date())}
              </Text>
            ) : null}
          </View>
          <View className="mt-0.5 flex-row items-center justify-between">
            {label !== undefined ? (
              <View className="mr-2 flex-1 flex-row items-center gap-1.5">
                <PulseDot color={MUTED_FOREGROUND[scheme]} />
                <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
                  {label}
                </Text>
              </View>
            ) : (
              <Text numberOfLines={1} className="mr-2 flex-1 text-[14px] text-muted-foreground">
                {preview.prefix ? <Text color="#d4d4d4">{preview.prefix}</Text> : null}
                {body}
              </Text>
            )}
            {chat.unread > 0 ? (
              <UnreadBadge count={chat.unread} muted={chat.muted} />
            ) : showTicks && last ? (
              <Ticks
                status={last.status as MessageStatus}
                color={last.status === 'read' ? '#ededed' : MUTED_FOREGROUND[scheme]}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
