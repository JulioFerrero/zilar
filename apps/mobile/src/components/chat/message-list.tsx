import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { JumpToBottom } from '@/components/chat/jump-to-bottom';
import { LoadError } from '@/components/chat/load-error';
import { MessageListRow, type ListEntry } from '@/components/chat/message-list-row';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { useMessageListScroll } from '@/components/chat/use-message-list-scroll';
import { useStableHandler, useStableReact } from '@/components/chat/use-stable-handlers';
import type { VoicePlayerHost } from '@/components/chat/voice-player';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { StateMessage } from '@/components/ui/state-message';
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
  /** Called when the Retry is tapped on a failed voice send. */
  onRetryVoice?: ((message: UiMessage) => void) | undefined;
  /** Called when Cancel is tapped while a voice message uploads. */
  onCancelVoice?: ((message: UiMessage) => void) | undefined;
  /** Called when a file row is tapped (system open sheet). */
  onOpenAttachment?: ((message: UiMessage) => void) | undefined;
  /** The message id currently downloading for the open sheet. */
  openingAttachmentId?: string | undefined;
  /** The shared voice player host from the chat screen (T-0154). */
  voiceHost?: VoicePlayerHost | undefined;
  /** Multi-select for forwarding (T-0445): present while picking messages. */
  selection?:
    | {
        ids: readonly string[];
        onToggle: (message: UiMessage) => void;
        onStart: (message: UiMessage) => void;
      }
    | undefined;
};

/** Whether the list's last row is a message the current user sent. */
function isOutgoingMessage(entry: ListEntry | undefined, currentUserId: string): boolean {
  return entry?.type === 'message' && entry.item.message.senderId === currentUserId;
}

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
  // A blocked person's group or channel messages are dropped before grouping,
  // exactly as web does; my own messages always stay. DMs and AI chats are
  // never filtered. The filter is memoised so a store update that leaves the
  // inputs unchanged does not hand a new array to `groupMessages` and the list.
  const visibleMessages = useMemo(
    () => filterBlockedMessages(chat, messages, blockedJids, currentUserId),
    [chat, messages, blockedJids, currentUserId],
  );
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
    () =>
      groupMessages(
        draftMessage === undefined ? visibleMessages : [...visibleMessages, draftMessage],
      ),
    [visibleMessages, draftMessage],
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

  // The list is inverted, so its data runs newest-first: offset 0 is the newest
  // message at the bottom and a chat opens there with no mount scroll. Every
  // index below is an index into this reversed data. The divider is inserted at
  // `dividerIndex` in `entries`, so its reversed position is measured from the
  // other end. On screen nothing changes: `inverted` flips the reversed data
  // back into the date order the user sees.
  const reversedEntries = useMemo(() => [...entries].reverse(), [entries]);
  // Snapshotted once per chat open, like `dividerIndex` above: the reversed
  // position shifts as history or a draft grows, so deriving it from the live
  // `entries.length` would re-run the mount divider scroll on every new message
  // and yank the view back to the divider.
  const [reversedDividerIndex] = useState<number | null>(() =>
    dividerIndex === null ? null : entries.length - 1 - dividerIndex,
  );

  const { listRef, atBottom, unseenCount, handleScroll, handleContentSizeChange } =
    useMessageListScroll({
      chatId: chat.id,
      dividerIndex: reversedDividerIndex,
      jumpTarget,
      jumpToMessageId,
      entries: reversedEntries,
      newestEntryKey: reversedEntries[0]?.key,
      newestEntryOutgoing: isOutgoingMessage(reversedEntries[0], currentUserId),
      clearJumpTarget,
      onJumped,
    });

  const jumpToBottom = useCallback(() => {
    // The inverted list's bottom is offset 0.
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [listRef]);

  // Stable so a re-render of the list does not hand the FlatList a new
  // `renderItem` and re-render every visible row (T-1188). The memoised row and
  // the reused entry objects do the rest.
  const renderItem = useCallback(
    ({ item }: { item: ListEntry }) => (
      <MessageListRow
        item={item}
        chat={chat}
        currentUserId={currentUserId}
        canPinChat={canPinChat}
        pinnedIds={pinnedIds}
        openingAttachmentId={openingAttachmentId}
        voiceHost={voiceHost}
        selection={selection}
        onReply={stableReply ?? onReply}
        onReact={stableReact}
        onEdit={stableEdit}
        onDelete={stableDelete}
        onForward={stableForward}
        onPin={stablePin}
        onUnpin={stableUnpin}
        onRetrySticker={stableRetrySticker}
        onRetryAttachment={stableRetryAttachment}
        onCancelAttachment={stableCancelAttachment}
        onRetryVoice={stableRetryVoice}
        onCancelVoice={stableCancelVoice}
        onOpenAttachment={stableOpenAttachment}
        onToggleSelect={stableToggle}
        onStartSelect={stableStart}
      />
    ),
    [
      chat,
      currentUserId,
      canPinChat,
      pinnedIds,
      openingAttachmentId,
      voiceHost,
      selection,
      stableReply,
      onReply,
      stableReact,
      stableEdit,
      stableDelete,
      stableForward,
      stablePin,
      stableUnpin,
      stableRetrySticker,
      stableRetryAttachment,
      stableCancelAttachment,
      stableRetryVoice,
      stableCancelVoice,
      stableOpenAttachment,
      stableToggle,
      stableStart,
    ],
  );

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
        <StateMessage kind="empty" title="No messages yet" />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <FlatList
        ref={listRef}
        className="flex-1"
        data={reversedEntries}
        inverted
        keyExtractor={(entry) => entry.key}
        initialNumToRender={20}
        windowSize={11}
        maxToRenderPerBatch={10}
        // `minIndexForVisible: 1` anchors on the previous newest row, so a new
        // message arriving at index 0 does not move someone reading older
        // messages. `autoscrollToTopThreshold` makes the native adjustment scroll
        // back to offset 0 (the inverted list's bottom) when the user was already
        // there, so a new message follows without fighting the anchor.
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
        contentContainerStyle={{ paddingVertical: 8 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        // Older pages sit at the inverted list's end, so reaching it asks for the
        // previous page of history (replacing the top-offset check).
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasMore) {
            loadOlder(chat.id);
          }
        }}
        // Re-pins after a followed message's row has rendered, in case the
        // maintain-visible adjustment moved the offset off the bottom.
        onContentSizeChange={handleContentSizeChange}
        onScroll={handleScroll}
        renderItem={renderItem}
      />
      <JumpToBottom atBottom={atBottom} count={unseenCount} onPress={jumpToBottom} />
    </View>
  );
}
