import { ChevronLeft, MoreVertical, Search } from 'lucide-react-native';
import { View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { TypingDots } from '@/components/chat/typing-dots';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { chatSubtitle } from '@/lib/chat';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { typingLabel } from '@/lib/format';
import type { ChatSummary } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store';
import { useColorScheme } from 'nativewind';

type ChatHeaderProps = {
  chat: ChatSummary;
  onBack: () => void;
};

/** Chat header: back, avatar, name + AI badge, subtitle, search and menu. */
export function ChatHeader({ chat, onBack }: ChatHeaderProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const color = FOREGROUND[scheme];
  const names = useChatStore((state) => state.typing[chat.id]?.names);
  const typing = typingLabel(chat, names ?? []);
  const working = chat.isAI && chat.aiStatus === 'working';
  const subtitle = typing ?? chatSubtitle(chat, new Date());
  return (
    <View className="flex-row items-center bg-background py-1.5 pl-1 pr-1">
      <IconButton label="Back" onPress={onBack}>
        <ChevronLeft size={26} color={color} />
      </IconButton>
      <Avatar id={chat.id} name={chat.title} size={42} online={chat.online} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text numberOfLines={1} className="text-[17px] font-semibold text-foreground">
            {chat.title}
          </Text>
          {chat.isAI ? <AiBadge /> : null}
        </View>
        <View className="flex-row items-center gap-1">
          <Text
            numberOfLines={1}
            className={cn(
              'text-[14px]',
              typing !== undefined ? 'text-accent' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </Text>
          {working || typing !== undefined ? (
            <TypingDots color={typing !== undefined ? ACCENT[scheme] : MUTED_FOREGROUND[scheme]} />
          ) : null}
        </View>
      </View>
      <IconButton label="Search in chat">
        <Search size={22} color={color} />
      </IconButton>
      <IconButton label="More options">
        <MoreVertical size={22} color={color} />
      </IconButton>
    </View>
  );
}
