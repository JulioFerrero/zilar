import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { ChatRowFactsProvider } from '@/components/chat/chat-row-facts';
import { EmptyChat } from '@/components/chat/empty-chat';
import { JumpToBottom } from '@/components/chat/jump-to-bottom';
import { LoadError } from '@/components/chat/load-error';
import { MessageListRow, type ListEntry } from '@/components/chat/message-list-row';
import { MessageMenuHost } from '@/components/chat/message-menu-host';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { useMessageListScroll } from '@/components/chat/use-message-list-scroll';
import { useStableHandler, useStableReact } from '@/components/chat/use-stable-handlers';
import type { VoicePlayerHost } from '@/components/chat/voice-player';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { useBlockedJids, filterBlockedMessages } from '@/lib/blocked-users';
import { runLater } from '@/lib/effect/timers';
import { useChatStore } from '@/store/chat-store-provider';
import { draftEntryKey, messagesListView } from '@/store/types';

type MessageListProps = {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
  onReact?: (message: UiMessage, emoji: string) => void;
  onEdit?: (message: UiMessage) => void;
  onDelete?: (message: UiMessage) => void;
  onForward?: (message: UiMessage) => void;
  onPin?: (message: UiMessage) => void;
  onUnpin?: (message: UiMessage) => void;
  pinnedIds: readonly string[];
  jumpToMessageId?: string | undefined;
  onJumped?: () => void;
  onRetrySticker?: ((message: UiMessage) => void) | undefined;
  onRetryAttachment?: ((message: UiMessage) => void) | undefined;
  onCancelAttachment?: ((message: UiMessage) => void) | undefined;
  onRetryVoice?: ((message: UiMessage) => void) | undefined;
  onCancelVoice?: ((message: UiMessage) => void) | undefined;
  onOpenAttachment?: ((message: UiMessage) => void) | undefined;
  openingAttachmentId?: string | undefined;
  voiceHost?: VoicePlayerHost | undefined;
  selection?:
    | {
        ids: readonly string[];
        onToggle: (message: UiMessage) => void;
        onStart: (message: UiMessage) => void;
      }
    | undefined;
};

function isOutgoingMessage(entry: ListEntry | undefined, currentUserId: string): boolean {
  return entry?.type === 'message' && entry.item.message.senderId === currentUserId;
}

/** Grouped by sender and day; opens at the unread divider, not the bottom. */
export function MessageList({
  chat,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onForward,
  onPin,
  onUnpin,
  pinnedIds,
  jumpToMessageId,
  onJumped,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onRetryVoice,
  onCancelVoice,
  onOpenAttachment,
  openingAttachmentId,
  voiceHost,
  selection,
}: MessageListProps) {
  const stableReply = useStableHandler(onReply);
  const stableReact = useStableReact(onReact);
  const stableEdit = useStableHandler(onEdit);
  const stableDelete = useStableHandler(onDelete);
  const stableForward = useStableHandler(onForward);
  const stablePin = useStableHandler(onPin);
  const stableUnpin = useStableHandler(onUnpin);
  const stableRetrySticker = useStableHandler(onRetrySticker);
  const stableRetryAttachment = useStableHandler(onRetryAttachment);
  const stableCancelAttachment = useStableHandler(onCancelAttachment);
  const stableRetryVoice = useStableHandler(onRetryVoice);
  const stableCancelVoice = useStableHandler(onCancelVoice);
  const stableOpenAttachment = useStableHandler(onOpenAttachment);
  const stableToggle = useStableHandler(selection?.onToggle);
  const stableStart = useStableHandler(selection?.onStart);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const messages = useChatStore((state) => state.messages(chat.id));
  const { api: contactsApi } = useContactsApi();
  const blockedJids = useBlockedJids(contactsApi);
  // A blocked person's group or channel messages are dropped before grouping, as web does; my own always stay. The filter is memoised so an unchanged store update does not hand `groupMessages` a new array.
  const visibleMessages = useMemo(
    () => filterBlockedMessages(chat, messages, blockedJids, currentUserId),
    [chat, messages, blockedJids, currentUserId],
  );
  const jumpTarget = useChatStore((state) =>
    state.jumpTarget?.chatId === chat.id ? state.jumpTarget : undefined,
  );
  const clearJumpTarget = useChatStore((state) => state.clearJumpTarget);
  // No data yet means never requested, so the first paint before `openChat` is loading, never empty.
  const historyLoad = useChatStore((state) => state.historyLoad[chat.id] ?? 'loading');
  const retryHistory = useChatStore((state) => state.retryHistory);
  const draft = useChatStore((state) => state.drafts[chat.id]);
  const finishedDraftMessages = useChatStore((state) => state.finishedDraftMessages);
  const loadOlder = useChatStore((state) => state.loadOlder);
  const hasMore = useChatStore((state) => state.hasMore(chat.id));
  const canPinChat = useChatStore((state) => state.canPin(chat.id));
  const draftText = draft?.text.trim() ?? '';
  // The draft renders as the AI's next message, so grouping and styles match the final message.
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
    () =>
      groupMessages(
        draftMessage === undefined ? visibleMessages : [...visibleMessages, draftMessage],
      ),
    [visibleMessages, draftMessage],
  );
  // The anchor (the unread count) is fixed when the chat opens, before `openChat` clears it; the index is recomputed from live `items` like web, so prepended pages do not move the divider.
  const [initialUnread] = useState(() => chat.unread);
  const dividerIndex = unreadDividerIndex(items, initialUnread, currentUserId);

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
      // The final message keeps the draft's key so the bubble and its reveal are reused.
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

  // The list is inverted: data runs newest-first, offset 0 is the bottom, and every index below indexes this reversed data.
  const reversedEntries = useMemo(() => [...entries].reverse(), [entries]);
  // The divider's reversed position stays on the same unread message as the list grows, so the mount scroll does not re-run.
  const reversedDividerIndex = dividerIndex === null ? null : entries.length - 1 - dividerIndex;

  const isGroup = chat.kind === 'group';
  // Stable so the prefetch's retry timer always asks for this chat's page.
  const loadOlderPage = useCallback(() => loadOlder(chat.id), [loadOlder, chat.id]);

  const { listRef, atBottom, unseenCount, handleScroll, handleContentSizeChange } =
    useMessageListScroll({
      chatId: chat.id,
      dividerIndex: reversedDividerIndex,
      jumpTarget,
      jumpToMessageId,
      entries: reversedEntries,
      newestEntryKey: reversedEntries[0]?.key,
      newestEntryOutgoing: isOutgoingMessage(reversedEntries[0], currentUserId),
      hasMore,
      loadOlder: loadOlderPage,
      clearJumpTarget,
      onJumped,
    });

  const jumpToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [listRef]);

  // Stable so a re-render does not hand the FlatList a new `renderItem` and re-render every row.
  const renderItem = useCallback(
    ({ item }: { item: ListEntry }) => (
      <MessageListRow
        item={item}
        isGroup={isGroup}
        currentUserId={currentUserId}
        canPinChat={canPinChat}
        pinnedIds={pinnedIds}
        openingAttachmentId={openingAttachmentId}
        voiceHost={voiceHost}
        selection={selection}
        onReply={stableReply ?? onReply}
        onReact={stableReact}
        onForward={stableForward}
        onRetrySticker={stableRetrySticker}
        onRetryAttachment={stableRetryAttachment}
        onCancelAttachment={stableCancelAttachment}
        onRetryVoice={stableRetryVoice}
        onCancelVoice={stableCancelVoice}
        onOpenAttachment={stableOpenAttachment}
        onToggleSelect={stableToggle}
      />
    ),
    [
      isGroup,
      currentUserId,
      canPinChat,
      pinnedIds,
      openingAttachmentId,
      voiceHost,
      selection,
      stableReply,
      onReply,
      stableReact,
      stableForward,
      stableRetrySticker,
      stableRetryAttachment,
      stableCancelAttachment,
      stableRetryVoice,
      stableCancelVoice,
      stableOpenAttachment,
      stableToggle,
    ],
  );

  // Empty text and Retry appear once the first page settles; live messages render immediately.
  const view = messagesListView(historyLoad, entries.length);
  if (view !== 'messages') {
    if (view === 'skeleton') {
      return <MessageListSkeleton />;
    }
    if (view === 'error') {
      return (
        <LoadError
          message="Could not load messages. Try again."
          onRetry={() => retryHistory(chat.id)}
        />
      );
    }
    return <EmptyChat chat={chat} />;
  }

  // A topic keeps a fixed gap under its newest message for the AI pill.
  return (
    <MessageMenuHost
      onReply={stableReply ?? onReply}
      onEdit={stableEdit}
      onDelete={stableDelete}
      onForward={stableForward}
      onStartSelect={stableStart}
      onPin={stablePin}
      onUnpin={stableUnpin}
      react={stableReact}
    >
      <ChatRowFactsProvider chat={chat} currentUserId={currentUserId}>
        <View className="flex-1">
          <FlatList
            ref={listRef}
            className="flex-1"
            data={reversedEntries}
            inverted
            keyExtractor={(entry) => entry.key}
            initialNumToRender={15}
            windowSize={9}
            maxToRenderPerBatch={5}
            updateCellsBatchingPeriod={32}
            // `minIndexForVisible: 1` anchors the previous newest row, so a new message does not move a reader of older messages; `autoscrollToTopThreshold` scrolls back to offset 0 when already there.
            maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: 40 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              runLater(50, () =>
                listRef.current?.scrollToIndex({
                  index: info.index,
                  viewPosition: 0.5,
                  animated: false,
                }),
              );
            }}
            contentContainerStyle={{
              paddingTop: chat.topic !== undefined ? 44 : 8,
              paddingBottom: 8,
            }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            // Older pages sit at the inverted end; three viewports of warning keep a fling from hitting it before the page arrives.
            onEndReachedThreshold={3}
            onEndReached={() => {
              if (hasMore) {
                loadOlderPage();
              }
            }}
            // Re-pins after a followed message's row rendered, in case the maintain-visible adjustment moved off the bottom.
            onContentSizeChange={handleContentSizeChange}
            onScroll={handleScroll}
            renderItem={renderItem}
          />
          <JumpToBottom atBottom={atBottom} count={unseenCount} onPress={jumpToBottom} />
        </View>
      </ChatRowFactsProvider>
    </MessageMenuHost>
  );
}
