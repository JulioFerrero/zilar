import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type MessageItem,
  type UiMessage,
} from '@galena/chat-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import { DateSeparator } from '@/components/chat/date-separator';
import { startJumpScroll } from '@/components/chat/jump-scroll';
import { LoadError } from '@/components/chat/load-error';
import { MessageBubble } from '@/components/chat/message-bubble';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { UnreadDivider } from '@/components/chat/unread-divider';
import { Text } from '@/components/ui/text';
import { useChatStore } from '@/store/chat-store-provider';
import { draftEntryKey, messagesListView } from '@/store/types';

type ListEntry =
  | { type: 'divider'; key: string }
  | { type: 'separator'; key: string; date: Date }
  | {
      type: 'message';
      key: string;
      item: MessageItem;
      isDraft: boolean;
      revealTurnId: string | undefined;
    };

type MessageListProps = {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
  onReact?: (message: UiMessage, emoji: string) => void;
  onEdit?: (message: UiMessage) => void;
  onDelete?: (message: UiMessage) => void;
  onPin?: (message: UiMessage) => void;
  onUnpin?: (message: UiMessage) => void;
  /** Message ids with a pin, from the screen's single pins subscription. */
  pinnedIds: readonly string[];
  /** The message id to scroll to once it renders (a pin jump). */
  jumpToMessageId?: string | undefined;
  onJumped?: () => void;
  /** Called when the sticker Retry is tapped on a failed sticker send. */
  onRetrySticker?: ((message: UiMessage) => void) | undefined;
  /** Called when the Retry is tapped on a failed attachment upload. */
  onRetryAttachment?: ((message: UiMessage) => void) | undefined;
  /** Called when Cancel is tapped while an attachment uploads. */
  onCancelAttachment?: ((message: UiMessage) => void) | undefined;
  /** Called when a file row is tapped (system open sheet). */
  onOpenAttachment?: ((message: UiMessage) => void) | undefined;
  /** The message id currently downloading for the open sheet. */
  openingAttachmentId?: string | undefined;
};

/**
 * Message list grouped by sender and day. Opening a chat with unread messages
 * scrolls to the "Unread messages" divider instead of the bottom.
 */
export function MessageList({
  chat,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  pinnedIds,
  jumpToMessageId,
  onJumped,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onOpenAttachment,
  openingAttachmentId,
}: MessageListProps) {
  const currentUserId = useChatStore((state) => state.currentUserId);
  const messages = useChatStore((state) => state.messages(chat.id));
  const jumpTarget = useChatStore((state) =>
    state.jumpTarget?.chatId === chat.id ? state.jumpTarget : undefined,
  );
  const clearJumpTarget = useChatStore((state) => state.clearJumpTarget);
  // Unknown means never requested: the real store has no data without asking,
  // so the first paint (before `openChat` runs) is loading, never empty.
  const historyLoad = useChatStore((state) => state.historyLoad[chat.id] ?? 'loading');
  const retryHistory = useChatStore((state) => state.retryHistory);
  const draft = useChatStore((state) => state.drafts[chat.id]);
  const finishedDraftMessages = useChatStore((state) => state.finishedDraftMessages);
  const loadOlder = useChatStore((state) => state.loadOlder);
  const hasMore = useChatStore((state) => state.hasMore(chat.id));
  const canPinChat = useChatStore((state) => state.canPin(chat.id));
  const draftText = draft?.text.trim() ?? '';
  // The draft is rendered as the AI's next message, so grouping, styles and size
  // are identical to the final message that replaces it.
  const draftMessage = useMemo<UiMessage | undefined>(() => {
    if (draft === undefined || draftText.length === 0) {
      return undefined;
    }
    return {
      id: `draft-${draft.turnId}`,
      chatId: chat.id,
      senderId: chat.id,
      senderName: chat.title,
      text: draftText,
      createdAt: new Date(
        Math.max(new Date().getTime(), (messages.at(-1)?.createdAt.getTime() ?? 0) + 1),
      ),
      status: 'read',
    };
  }, [draft, draftText, chat.id, chat.title, messages]);
  const items = useMemo(
    () => groupMessages(draftMessage === undefined ? messages : [...messages, draftMessage]),
    [messages, draftMessage],
  );
  // The divider position is fixed when the chat opens, before `openChat` clears
  // the unread count, so it does not move as new messages arrive.
  const [dividerIndex] = useState(() => unreadDividerIndex(items, chat.unread));

  const entries = useMemo(() => {
    const list: ListEntry[] = [];
    items.forEach((item, index) => {
      if (dividerIndex === index) {
        list.push({ type: 'divider', key: 'unread-divider' });
      }
      if (item.kind === 'separator') {
        list.push({ type: 'separator', key: item.id, date: item.date });
        return;
      }
      const isDraft = item.message.id === draftMessage?.id;
      // The final message keeps the draft's key so the bubble (and its reveal)
      // is reused instead of snapping in as a new message.
      const revealTurnId = isDraft ? draft?.turnId : finishedDraftMessages[item.message.id];
      list.push({
        type: 'message',
        key: draftEntryKey(item.message.id, finishedDraftMessages),
        item,
        isDraft,
        revealTurnId,
      });
    });
    return list;
  }, [items, dividerIndex, draftMessage, draft, finishedDraftMessages]);

  const listRef = useRef<FlatList<ListEntry>>(null);
  const previousCount = useRef(messages.length);
  // True while the user is at (or near) the bottom, so a growing draft or a new
  // message keeps the view pinned; someone reading older messages is not moved.
  const atBottomRef = useRef(true);

  // Scroll after mount and again a few times while images and the list settle.
  // A search jump owns the scroll instead: the jump effect below lands on the
  // message, so the mount scroll stays out of its way.
  useEffect(() => {
    if (jumpTarget !== undefined) {
      return;
    }
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
  }, [chat.id, dividerIndex, jumpTarget]);

  useEffect(() => {
    // A search jump owns the scroll while its target is set; a live message
    // arriving in that window must not yank the view to the bottom.
    if (jumpTarget === undefined && messages.length > previousCount.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
    previousCount.current = messages.length;
  }, [messages.length, jumpTarget]);

  // A search hit lands here: once the jump target's message is loaded, scroll
  // to it (centered) and confirm the target on the LAST retry so a later
  // message with the same id does not re-scroll. `startJumpScroll`
  // re-resolves the index on every retry: a message arriving within 400 ms
  // of the jump moves every row below it, so a captured index would scroll
  // to a stale row — and confirming early would clear the target before the
  // retries could follow it (T-0147).
  const jumpMessageId = jumpTarget?.messageId;
  useEffect(() => {
    if (jumpMessageId === undefined) {
      return;
    }
    return startJumpScroll({
      findIndex: () =>
        entries.findIndex(
          (entry) => entry.type === 'message' && entry.item.message.id === jumpMessageId,
        ),
      scrollToIndex: (index) =>
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }),
      onDone: clearJumpTarget,
    });
  }, [jumpMessageId, entries, clearJumpTarget]);

  // A pin jump scrolls to the target bubble once it renders. Only fires
  // when the message is loaded (the banner shows "Message not found" when
  // it is not — mobile has no history paging yet).
  useEffect(() => {
    if (jumpToMessageId === undefined) {
      return;
    }
    const index = entries.findIndex(
      (entry) => entry.type === 'message' && entry.item.message.id === jumpToMessageId,
    );
    if (index === -1) {
      return;
    }
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      onJumped?.();
    }, 100);
    return () => clearTimeout(timer);
  }, [jumpToMessageId, entries, onJumped]);

  // Loading, error and empty are three different states: the empty text and
  // the Retry only appear once the first page has settled. Live messages that
  // arrive while loading render immediately, as before.
  const view = messagesListView(historyLoad, entries.length);
  if (view !== 'messages') {
    if (view === 'skeleton') {
      return <MessageListSkeleton />;
    }
    if (view === 'error') {
      return <LoadError message="Couldn't load messages" onRetry={() => retryHistory(chat.id)} />;
    }
    return (
      <View className="flex-1 items-center justify-center p-8">
        <Text className="text-[15px] text-muted-foreground">No messages yet</Text>
      </View>
    );
  }

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
      onContentSizeChange={() => {
        // Frame-by-frame reveal growth raises the content height; keep the view
        // pinned only while the user is already at the bottom.
        if (atBottomRef.current) {
          listRef.current?.scrollToEnd({ animated: false });
        }
      }}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        atBottomRef.current =
          contentSize.height - (contentOffset.y + layoutMeasurement.height) < 40;
        // Scrolling to the top asks for the previous page of history.
        if (hasMore && contentOffset.y <= 24) {
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
            {...(onReact === undefined ? {} : { onReact })}
            {...(onEdit === undefined ? {} : { onEdit })}
            {...(onDelete === undefined ? {} : { onDelete })}
            canPin={canPinChat}
            isPinned={pinnedIds.includes(item.item.message.id)}
            {...(onPin === undefined ? {} : { onPin })}
            {...(onUnpin === undefined ? {} : { onUnpin })}
            draft={item.isDraft}
            revealTurnId={item.revealTurnId}
            {...(onRetrySticker === undefined ? {} : { onRetrySticker })}
            {...(onRetryAttachment === undefined ? {} : { onRetryAttachment })}
            {...(onCancelAttachment === undefined ? {} : { onCancelAttachment })}
            {...(onOpenAttachment === undefined ? {} : { onOpenAttachment })}
            {...(openingAttachmentId === undefined ? {} : { openingAttachmentId })}
          />
        );
      }}
    />
  );
}
