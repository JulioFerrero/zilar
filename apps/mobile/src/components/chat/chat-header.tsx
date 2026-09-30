import { ChevronLeft, Lock, MoreVertical, Search } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { TypingDots } from '@/components/chat/typing-dots';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { chatSubtitle } from '@/lib/chat';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { typingLabel } from '@/lib/format';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';
import { useColorScheme } from 'nativewind';

type ChatHeaderProps = {
  chat: ChatSummary;
  onBack: () => void;
  /** Opens the full-screen search scoped to this chat ("Search in chat"). */
  onSearchInChat?: () => void;
  /** The group name shown small above a topic name (T-0112). */
  topicGroupName?: string;
  /** Opens the topic-info sheet when the header is tapped (topics only). */
  onOpenInfo?: () => void;
};

/**
 * Chat header: back, avatar, name + AI badge, subtitle, search and menu. For
 * a topic (T-0112) the topic name shows with the group name small above it
 * and a Private chip, and tapping the title opens the topic-info sheet.
 */
export function ChatHeader({
  chat,
  onBack,
  onSearchInChat,
  topicGroupName,
  onOpenInfo,
}: ChatHeaderProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const iconColor = ICON[scheme];
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
  const typing = typingLabel(chat, names ?? []);
  const writing = chat.isAI && (typing !== undefined || hasDraft);
  const subtitle = writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date()));
  const working = chat.isAI && chat.aiStatus === 'working';
  const isTopic = chat.topic !== undefined;
  const title = (
    <View className="ml-2.5 min-w-0 flex-1">
      {isTopic && topicGroupName !== undefined && topicGroupName !== '' ? (
        <Text numberOfLines={1} className="shrink text-[11px] text-subtle-foreground">
          {topicGroupName}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-1.5">
        <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
          {chat.title}
        </Text>
        {isTopic && chat.topic?.visibility === 'private' ? (
          <View
            accessibilityRole="image"
            accessibilityLabel="Private topic"
            className="shrink-0 flex-row items-center gap-1 rounded-full border border-divider px-1.5 py-0.5"
          >
            <Lock size={10} color={MUTED_FOREGROUND[scheme]} />
            <Text className="text-[10px] font-medium text-muted-foreground">Private</Text>
          </View>
        ) : null}
        {chat.isAI ? <AiBadge /> : null}
      </View>
      <View className="flex-row items-center gap-1">
        <Text numberOfLines={1} className="shrink text-[12px] text-muted-foreground">
          {subtitle}
        </Text>
        {working || writing ? <TypingDots color={MUTED_FOREGROUND[scheme]} /> : null}
      </View>
    </View>
  );
  return (
    <View className="h-16 flex-row items-center gap-1 border-b border-divider bg-surface px-1">
      <IconButton label="Back" onPress={onBack}>
        <ChevronLeft size={24} color={iconColor} />
      </IconButton>
      <Avatar id={chat.id} name={chat.title} size={36} online={chat.online} ai={chat.isAI} />
      {isTopic && onOpenInfo !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Topic info for ${chat.title}`}
          onPress={onOpenInfo}
          className="min-w-0 flex-1"
        >
          {title}
        </Pressable>
      ) : (
        title
      )}
      <IconButton label="Search in chat" onPress={onSearchInChat}>
        <Search size={20} color={iconColor} />
      </IconButton>
      <IconButton label="More options" onPress={isTopic ? onOpenInfo : undefined}>
        <MoreVertical size={20} color={iconColor} />
      </IconButton>
    </View>
  );
}
