import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type MessageItem,
  type UiMessage,
} from '@galena/chat-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList } from 'react-native';

import { DateSeparator } from '@/components/chat/date-separator';
import { MessageBubble } from '@/components/chat/message-bubble';
import { UnreadDivider } from '@/components/chat/unread-divider';
import { useChatStore } from '@/store/chat-store-provider';

type ListEntry =
  | { type: 'divider'; key: string }
  | { type: 'separator'; key: string; date: Date }
  | { type: 'message'; key: string; item: MessageItem };

type MessageListProps = {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
};

/**
 * Message list grouped by sender and day. Opening a chat with unread messages
 * scrolls to the "Unread messages" divider instead of the bottom.
 */
export function MessageList({ chat, onReply }: MessageListProps) {
  const currentUserId = useChatStore((state) => state.currentUserId);
  const messages = useChatStore((state) => state.messages(chat.id));
  const loadOlder = useChatStore((state) => state.loadOlder);
  const hasMore = useChatStore((state) => state.hasMore(chat.id));
  const items = useMemo(() => groupMessages(messages), [messages]);
  // The divider position is fixed when the chat opens, before `openChat` clears
  // the unread count, so it does not move as new messages arrive.
  const [dividerIndex] = useState(() => unreadDividerIndex(items, chat.unread));

  const entries = useMemo(() => {
    const list: ListEntry[] = [];
    items.forEach((item, index) => {
      if (dividerIndex === index) {
        list.push({ type: 'divider', key: 'unread-divider' });
      }
      list.push(
        item.kind === 'separator'
          ? { type: 'separator', key: item.id, date: item.date }
          : { type: 'message', key: item.message.id, item },
      );
    });
    return list;
  }, [items, dividerIndex]);

  const listRef = useRef<FlatList<ListEntry>>(null);
  const previousCount = useRef(messages.length);

  // Scroll after mount and again a few times while images and the list settle.
  useEffect(() => {
    const scroll = () => {
      if (dividerIndex !== null) {
        listRef.current?.scrollToIndex({ index: dividerIndex, viewPosition: 0.5, animated: false });
      } else {
        listRef.current?.scrollToEnd({ animated: false });
      }
    };
    scroll();
    const timers = [80, 200, 400, 700].map((ms) => setTimeout(scroll, ms));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [chat.id, dividerIndex]);

  useEffect(() => {
    if (messages.length > previousCount.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
    previousCount.current = messages.length;
  }, [messages.length]);

  return (
    <FlatList
      ref={listRef}
      className="flex-1"
      data={entries}
      keyExtractor={(entry) => entry.key}
      initialNumToRender={Math.max(entries.length, 1)}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
        setTimeout(
          () =>
            listRef.current?.scrollToIndex({
              index: info.index,
              viewPosition: 0.5,
              animated: false,
            }),
          50,
        );
      }}
      contentContainerStyle={{ paddingVertical: 8 }}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(event) => {
        // Scrolling to the top asks for the previous page of history.
        if (hasMore && event.nativeEvent.contentOffset.y <= 24) {
          loadOlder(chat.id);
        }
      }}
      renderItem={({ item }) => {
        if (item.type === 'divider') {
          return <UnreadDivider />;
        }
        if (item.type === 'separator') {
          return <DateSeparator date={item.date} />;
        }
        return (
          <MessageBubble
            message={item.item.message}
            isGroup={chat.kind === 'group'}
            isFirstInGroup={item.item.firstInGroup}
            isLastInGroup={item.item.lastInGroup}
            currentUserId={currentUserId}
            onReply={onReply}
          />
        );
      }}
    />
  );
}
