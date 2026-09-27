import { ChevronLeft, MoreVertical, Search } from 'lucide-react-native';
import { View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { chatSubtitle } from '@/lib/chat';
import { asColorScheme } from '@/lib/color-scheme';
import { FOREGROUND } from '@/lib/colors';
import type { ChatSummary } from '@/lib/types';
import { useColorScheme } from 'nativewind';

type ChatHeaderProps = {
  chat: ChatSummary;
  onBack: () => void;
};

/** Chat header: back, avatar, name + AI badge, subtitle, search and menu. */
export function ChatHeader({ chat, onBack }: ChatHeaderProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const color = FOREGROUND[scheme];
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
        <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
          {chatSubtitle(chat, new Date())}
        </Text>
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
