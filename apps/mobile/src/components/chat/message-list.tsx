import {
  groupMessages,
  unreadDividerIndex,
  type AlbumItem,
  type ChatSummary,
  type MessageItem,
  type UiMessage,
  aiSuggestions,
  formatDateSeparator,
  providerLabel,
} from '@zilar/chat-core';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { AlbumMembersProvider } from '@/components/chat/album-members';
import { ChatRowFactsProvider } from '@/components/chat/chat-row-facts';
import { LoadError } from '@/components/chat/load-error';
import { MessageBubble } from '@/components/chat/message-bubble';
import type { ListEntry } from '@/components/chat/message-list-row';
import { MessageMenuHost } from '@/components/chat/message-menu-host';
import { MessageListSkeleton } from '@/components/chat/skeleton';
import { type MessageHandler, type ReactHandler } from '@/components/chat/use-stable-handlers';
import { useMessageListScroll } from '@/components/chat/use-message-list-scroll';
import { useStableHandler, useStableReact } from '@/components/chat/use-stable-handlers';
import type { VoicePlayerHost } from '@/components/chat/voice-player-host';
import { useContactsApi } from '@/components/contacts/use-contacts-api';
import { useBlockedJids, filterBlockedMessages } from '@/lib/blocked-users';
import { runLater } from '@zilar/client-core';
import { useChatStore } from '@/store/chat-store-provider';
import { draftEntryKey, messagesListView } from '@/store/types';
import { ChevronDown, MessageSquare } from 'lucide-react-native';
import { CountBadge } from '@/components/ui/count-badge';
import { IconButton } from '@/components/ui/icon-button';
import { ICON } from '@/lib/colors';
import { raisedPill, well } from '@/lib/depth';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useAisApi } from '@/components/ais/use-ais-api';
import { dmHandleFor } from '@/components/chat/chat-header';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { useQuery } from '@/lib/effect/use-query';

interface AiEmptyInfo {
  template: string;
  model: string;
}

function DateSeparator({ date }: { date: Date }) {
  return (
    <View className="my-2 items-center">
      <View className="rounded-full px-2.5 py-1" style={raisedPill}>
        <Text className="text-[12px] font-medium text-muted-foreground">
          {formatDateSeparator(date, new Date())}
        </Text>
      </View>
    </View>
  );
}

function UnreadDivider() {
  return (
    <View className="my-3 w-full px-3">
      <View className="w-full rounded-[10px] px-3 py-1.5" style={well}>
        <Text className="text-center text-[12px] font-medium text-muted-foreground">
          Unread messages
        </Text>
      </View>
    </View>
  );
}

type MessageListSelection = {
  ids: readonly string[];
  onToggle: (message: UiMessage) => void;
  onStart: (message: UiMessage) => void;
};

type MessageListRowProps = {
  item: ListEntry;
  isGroup: boolean;
  currentUserId: string;
  canPinChat: boolean;
  pinnedIds: readonly string[];
  openingAttachmentId: string | undefined;
  voiceHost: VoicePlayerHost | undefined;
  selection: MessageListSelection | undefined;
  onReply: MessageHandler;
  onReact: ReactHandler | undefined;
  onForward: MessageHandler | undefined;
  onRetrySticker: MessageHandler | undefined;
  onRetryAttachment: MessageHandler | undefined;
  onCancelAttachment: MessageHandler | undefined;
  onRetryVoice: MessageHandler | undefined;
  onCancelVoice: MessageHandler | undefined;
  onOpenAttachment: MessageHandler | undefined;
  onToggleSelect: MessageHandler | undefined;
};

function MessageListRowImpl({
  item,
  isGroup,
  currentUserId,
  canPinChat,
  pinnedIds,
  openingAttachmentId,
  voiceHost,
  selection,
  onReply,
  onReact,
  onForward,
  onRetrySticker,
  onRetryAttachment,
  onCancelAttachment,
  onRetryVoice,
  onCancelVoice,
  onOpenAttachment,
  onToggleSelect,
}: MessageListRowProps) {
  if (item.type === 'divider') {
    return <UnreadDivider />;
  }
  if (item.type === 'separator') {
    return <DateSeparator date={item.date} />;
  }
  // An album item renders its head bubble; the grid inside its attachment body draws exactly this run, so a colliding id or a far sibling cannot merge in.
  const albumMembers = item.item.kind === 'album' ? item.item.messages : null;
  return (
    <AlbumMembersProvider messages={albumMembers}>
      <MessageBubble
        message={item.item.message}
        isGroup={isGroup}
        isFirstInGroup={item.item.firstInGroup}
        isLastInGroup={item.item.lastInGroup}
        currentUserId={currentUserId}
        onReply={onReply}
        {...(onReact === undefined ? {} : { onReact })}
        {...(onForward === undefined ? {} : { onForward })}
        canPin={canPinChat}
        isPinned={pinnedIds.includes(item.item.message.id)}
        draft={item.isDraft}
        revealTurnId={item.revealTurnId}
        {...(onRetrySticker === undefined ? {} : { onRetrySticker })}
        {...(onRetryAttachment === undefined ? {} : { onRetryAttachment })}
        {...(onCancelAttachment === undefined ? {} : { onCancelAttachment })}
        {...(onRetryVoice === undefined ? {} : { onRetryVoice })}
        {...(onCancelVoice === undefined ? {} : { onCancelVoice })}
        {...(onOpenAttachment === undefined ? {} : { onOpenAttachment })}
        {...(openingAttachmentId === undefined ? {} : { openingAttachmentId })}
        {...(voiceHost === undefined ? {} : { voiceHost })}
        selecting={selection !== undefined && selection.ids.length > 0}
        selected={selection !== undefined && selection.ids.includes(item.item.message.id)}
        {...(onToggleSelect === undefined ? {} : { onToggleSelect })}
      />
    </AlbumMembersProvider>
  );
}

function isSameEntry(a: ListEntry, b: ListEntry): boolean {
  if (a === b) {
    return true;
  }
  if (a.type !== b.type || a.key !== b.key) {
    return false;
  }
  if (a.type === 'separator' && b.type === 'separator') {
    return a.date.getTime() === b.date.getTime();
  }
  if (a.type === 'message' && b.type === 'message') {
    return (
      a.item.message === b.item.message &&
      a.item.firstInGroup === b.item.firstInGroup &&
      a.item.lastInGroup === b.item.lastInGroup &&
      sameAlbumMembers(a.item, b.item) &&
      a.isDraft === b.isDraft &&
      a.revealTurnId === b.revealTurnId
    );
  }
  return true;
}

// Whether two entries carry the same album members; compared element by element because `groupMessages` rebuilds the array on every rebuild, and a sibling from an older page must re-render the grid.
function sameAlbumMembers(a: MessageItem | AlbumItem, b: MessageItem | AlbumItem): boolean {
  const aMembers = a.kind === 'album' ? a.messages : null;
  const bMembers = b.kind === 'album' ? b.messages : null;
  if (aMembers === null || bMembers === null) {
    return aMembers === bMembers;
  }
  return aMembers.length === bMembers.length && aMembers.every((m, index) => m === bMembers[index]);
}

// Whether the row can skip a render. `item` is rebuilt every list rebuild (a draft frame is one every ~150 ms), so it is compared field by field; the other props are compared by identity.
function areRowPropsEqual(prev: MessageListRowProps, next: MessageListRowProps): boolean {
  return (
    isSameEntry(prev.item, next.item) &&
    prev.isGroup === next.isGroup &&
    prev.currentUserId === next.currentUserId &&
    prev.canPinChat === next.canPinChat &&
    prev.pinnedIds === next.pinnedIds &&
    prev.openingAttachmentId === next.openingAttachmentId &&
    prev.voiceHost === next.voiceHost &&
    prev.selection === next.selection &&
    prev.onReply === next.onReply &&
    prev.onReact === next.onReact &&
    prev.onForward === next.onForward &&
    prev.onRetrySticker === next.onRetrySticker &&
    prev.onRetryAttachment === next.onRetryAttachment &&
    prev.onCancelAttachment === next.onCancelAttachment &&
    prev.onRetryVoice === next.onRetryVoice &&
    prev.onCancelVoice === next.onCancelVoice &&
    prev.onOpenAttachment === next.onOpenAttachment &&
    prev.onToggleSelect === next.onToggleSelect
  );
}

// Memoised: with the list's stable handlers, a draft frame re-renders only the row whose entry changed.
const MessageListRow = memo(MessageListRowImpl, areRowPropsEqual);

function EmptyChat({ chat }: { chat: ChatSummary }) {
  const { api: aisApi } = useAisApi();
  const { api: connectionsApi } = useConnectionsApi();
  const contacts = useChatStore((state) => state.contacts);
  const sendText = useChatStore((state) => state.sendText);

  const [aiResult] = useQuery(
    () =>
      chat.isAI
        ? Effect.promise(() => aisApi.listAis()).pipe(
            Effect.flatMap((ais) => {
              const found = ais.find((item) => item.jid === chat.id);
              if (found === undefined) {
                return Effect.succeed<AiEmptyInfo | null>(null);
              }
              const fallback: AiEmptyInfo = { template: found.template, model: found.model };
              return Effect.promise(() => connectionsApi.listConnections()).pipe(
                Effect.map((connections): AiEmptyInfo => {
                  const connection = connections.find(
                    (entry) => entry.id === found.providerConnectionId,
                  );
                  return connection === undefined
                    ? fallback
                    : {
                        template: found.template,
                        model: `${found.model} · ${providerLabel(connection.provider)}`,
                      };
                }),
                Effect.orElseSucceed((): AiEmptyInfo => fallback),
              );
            }),
          )
        : Effect.succeed<AiEmptyInfo | null>(null),
    [aisApi, connectionsApi, chat.id, chat.isAI],
  );
  const ai = AsyncResult.isSuccess(aiResult) ? aiResult.value : null;

  if (chat.isAI) {
    const suggestions = aiSuggestions(ai === null ? '' : ai.template);
    return (
      <View className="flex-1 items-center justify-center gap-3.5 px-4 py-6">
        <EntityAvatar chat={chat} size={80} ai />
        <View className="items-center gap-1">
          <Text className="text-[20px] font-semibold">{chat.title}</Text>
          {ai === null ? null : (
            <Text className="font-mono text-[12px] text-muted-foreground">{ai.model}</Text>
          )}
        </View>
        <View className="mt-2.5 items-center gap-2">
          {suggestions.map((text) => (
            <Button
              key={text}
              variant="outline"
              onPress={() => sendText(chat.id, text)}
              className="h-11 rounded-full px-4"
            >
              <Text className="text-[15px] font-medium">{text}</Text>
            </Button>
          ))}
        </View>
      </View>
    );
  }

  if (chat.kind === 'dm') {
    const handle = dmHandleFor(chat, contacts);
    return (
      <View className="flex-1 items-center justify-center gap-3.5 px-4 py-6">
        <EntityAvatar chat={chat} size={80} />
        <View className="items-center gap-1">
          <Text className="text-[20px] font-semibold">{chat.title}</Text>
          {handle === undefined ? null : (
            <Text className="font-mono text-[12px] text-muted-foreground">@{handle}</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center p-8">
      <StateMessage
        kind="empty"
        icon={MessageSquare}
        title="No messages yet"
        hint="Send a message to start the conversation."
      />
    </View>
  );
}

type JumpToBottomProps = {
  /** Whether the list is scrolled to (or within 40 px of) the bottom. */
  atBottom: boolean;
  count: number;
  onPress: () => void;
};

function JumpToBottom({ atBottom, count, onPress }: JumpToBottomProps) {
  if (atBottom) {
    return null;
  }
  return (
    <View className="absolute right-3 bottom-3">
      <IconButton
        label="Jump to latest messages"
        className="h-11 w-11 rounded-full"
        onPress={onPress}
      >
        <ChevronDown size={22} color={ICON} />
      </IconButton>
      {count > 0 ? (
        <View className="absolute -top-1 -right-1">
          <CountBadge count={count} />
        </View>
      ) : null}
    </View>
  );
}

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
