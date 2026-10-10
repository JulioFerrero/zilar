import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '@/components/chat/chat-header';
import type { ChatSummary } from '@/lib/types';

type ChatHeaderBarProps = {
  chat: ChatSummary;
  onBack: () => void;
  onSearchInChat: () => void;
  onOpenMedia: () => void;
  /** Opens the group screen for this row's group (T-0139). */
  onOpenGroup?: (groupId: string) => void;
  /** The group name shown small above a topic name (T-0112). */
  topicGroupName?: string;
  /** Opens the topic-info sheet when the header is tapped (topics only). */
  onOpenInfo?: () => void;
};

/** The top bar shared by the legacy, channel and topic branches of the chat screen. */
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
