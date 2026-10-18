import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '@/components/chat/chat-header';
import type { ChatSummary } from '@/lib/types';

type ChatHeaderBarProps = {
  chat: ChatSummary;
  onBack: () => void;
  onSearchInChat: () => void;
  onOpenMedia: () => void;
  onOpenGroup?: (groupId: string) => void;
  topicGroupName?: string;
  onOpenInfo?: () => void;
};

export function ChatHeaderBar({
  chat,
  onBack,
  onSearchInChat,
  onOpenMedia,
  onOpenGroup,
  topicGroupName,
  onOpenInfo,
}: ChatHeaderBarProps) {
  return (
    <SafeAreaView edges={['top']} className="bg-surface">
      <ChatHeader
        chat={chat}
        onBack={onBack}
        onSearchInChat={onSearchInChat}
        onOpenMedia={onOpenMedia}
        topicGroupName={topicGroupName}
        onOpenInfo={onOpenInfo}
        onOpenGroup={onOpenGroup}
      />
    </SafeAreaView>
  );
}
