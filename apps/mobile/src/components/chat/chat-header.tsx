import { ChevronLeft, MoreVertical, Search } from 'lucide-react-native';
import { View } from 'react-native';

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
};

/** Chat header: back, avatar, name + AI badge, subtitle, search and menu. */
export function ChatHeader({ chat, onBack }: ChatHeaderProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const iconColor = ICON[scheme];
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const hasDraft = useChatStore((state) => state.drafts[chat.id] !== undefined);
  const typing = typingLabel(chat, names ?? []);
  const writing = chat.isAI && (typing !== undefined || hasDraft);
  const subtitle = writing ? 'writing…' : (typing ?? chatSubtitle(chat, new Date()));
  const working = chat.isAI && chat.aiStatus === 'working';
  return (
    <View className="h-16 flex-row items-center gap-1 border-b border-divider bg-surface px-1">
      <IconButton label="Back" onPress={onBack}>
        <ChevronLeft size={24} color={iconColor} />
      </IconButton>
      <Avatar id={chat.id} name={chat.title} size={36} online={chat.online} ai={chat.isAI} />
      <View className="ml-2.5 min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
            {chat.title}
          </Text>
          {chat.isAI ? <AiBadge /> : null}
        </View>
        <View className="flex-row items-center gap-1">
          <Text numberOfLines={1} className="shrink text-[12px] text-muted-foreground">
            {subtitle}
          </Text>
          {working || writing ? <TypingDots color={MUTED_FOREGROUND[scheme]} /> : null}
        </View>
      </View>
      <IconButton label="Search in chat">
        <Search size={20} color={iconColor} />
      </IconButton>
      <IconButton label="More options">
        <MoreVertical size={20} color={iconColor} />
      </IconButton>
    </View>
  );
}
