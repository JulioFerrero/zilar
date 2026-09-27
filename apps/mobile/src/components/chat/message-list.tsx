import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { DateSeparator } from '@/components/chat/date-separator';
import { MessageBubble } from '@/components/chat/message-bubble';
import { groupMessages } from '@/lib/grouping';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store';

/** Inverted message list: newest at the bottom, grouped by sender and day. */
export function MessageList({ chat }: { chat: ChatSummary }) {
  const messages = useChatStore((state) => state.messages(chat.id));
  const items = useMemo(() => groupMessages(messages).reverse(), [messages]);
  const isGroup = chat.kind === 'group';
  return (
    <FlatList
      className="flex-1"
      data={items}
      inverted
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ paddingVertical: 8 }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) =>
        item.type === 'date' ? (
          <DateSeparator iso={item.iso} />
        ) : (
          <MessageBubble
            message={item.message}
            isGroup={isGroup}
            isFirstInGroup={item.isFirstInGroup}
            isLastInGroup={item.isLastInGroup}
          />
        )
      }
    />
  );
}
