import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { ArrowDown } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageListRow, messageRowKey } from './MessageListRow';
import { MessageAnnouncer } from './MessageAnnouncer';
import { MessageListSkeleton } from './Skeleton';
import { useMessageWindow } from './useMessageWindow';
import { useMessageListScroll } from './useMessageListScroll';
import { IconButton } from './ui/icon-button';
import { Badge } from './ui/badge';
import { StateMessage } from './ui/state-message';
import { EmptyChat } from './message/EmptyChat';
import { isBlockedSender, useBlockedJids } from '@/lib/blockedJids';
import { chatBackgroundStyle, effectiveBackground } from '@/lib/chatBackground';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const EMPTY_MESSAGES: UiMessage[] = [];

/** A callback whose identity never changes but always calls the latest `fn`. */
function useLatestCallback<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined,
): (...args: A) => void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current?.(...args), []);
}

export const MessageList = memo(function MessageList({
  chat,
  onReply,
  onForward,
  selection,
  selecting = false,
}: {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
  onForward?: (message: UiMessage) => void;
  /** Multi-select controller (T-0439). */
  selection?: {
    ids: ReadonlySet<string>;
    onToggle: (message: UiMessage) => void;
    onStart: (message: UiMessage) => void;
  };
  /** True while select mode is active (drives the checkbox UI). */
  selecting?: boolean;
}) {
  const storeApi = useChatStoreApi();
  const chatId = chat.id;
  const chatTitle = chat.title;
  const chatPref = useChatSelector((s) => s.chatPrefs[chatId.toLowerCase()]);
  const defaultBackground = useChatSelector((s) => s.defaultBackground);
  const storedMessages = useChatSelector((s) => s.messagesByChat[chatId]);
  const messages = storedMessages ?? EMPTY_MESSAGES;
  // Unknown means never requested, which the real store reports as loading:
  // first paint (before ChatView's openChat effect runs) must never flash
  // the empty state.
  const history = useChatSelector((s) => s.historyStateFor(chatId));
  // T-2011: one pin subscription for the whole list; each row gets its pin id.
  const pins = useChatSelector((s) => s.pinsByChat[chatId]);
  const pinIdByMessage = useMemo(() => {
    const map = new Map<string, string>();
    for (const pin of pins ?? []) {
      map.set(pin.messageId, pin.id);
    }
    return map;
  }, [pins]);
  const draft = useChatSelector((s) => s.drafts[chatId]);
  const finishedDraftMessages = useChatSelector((s) => s.finishedDraftMessages);
  const meId = useChatSelector((s) => s.currentUserId);
  const meJid = useChatSelector((s) => s.me?.jid ?? undefined);
  // T-0461/T-0466: the chat's own background, else the group's shared one,
  // else the caller's default, else slate (which paints no inline style).
  const backgroundStyle = chatBackgroundStyle(
    effectiveBackground(chatPref, defaultBackground, chat.groupBackground),
  );
  const draftText = draft?.text.trim() ?? '';
  const draftTurnId = draft?.turnId;
  const blockedJids = useBlockedJids();
  const hideBlocked = chat.kind === 'group' && chat.isAI !== true && blockedJids.size > 0;
  const visibleMessages = useMemo(
    () =>
      hideBlocked
        ? messages.filter(
            (message) =>
              message.senderId === meId || !isBlockedSender(message.senderId, blockedJids),
          )
        : messages,
    [hideBlocked, messages, meId, blockedJids],
  );
  // The draft is rendered as the AI's next message, so grouping, styles and
  // size are identical to the final message that replaces it.
  const draftMessage = useMemo<UiMessage | undefined>(
    () =>
      draftTurnId !== undefined && draftText.length > 0
        ? {
            id: `draft-${draftTurnId}`,
            chatId,
            senderId: chatId,
            senderName: chatTitle,
            text: draftText,
            createdAt: new Date(
              Math.max(new Date().getTime(), (messages.at(-1)?.createdAt.getTime() ?? 0) + 1),
            ),
            status: 'read',
          }
        : undefined,
    [draftTurnId, draftText, chatId, chatTitle, messages],
  );
  const items = useMemo(
    () =>
      groupMessages(
        draftMessage === undefined ? visibleMessages : [...visibleMessages, draftMessage],
      ),
    [visibleMessages, draftMessage],
  );
  // ChatView passes fresh callbacks on every render; the bubbles are memoised,
  // so hand them wrappers whose identity never changes.
  const handleReply = useLatestCallback(onReply);
  const handleForward = useLatestCallback(onForward);
  const handleToggleSelect = useLatestCallback(selection?.onToggle);
  const handleStartSelect = useLatestCallback(selection?.onStart);
  const selectedIds = selection?.ids;
  const [initialUnread] = useState(() => chat.unread);
  const dividerIndex = unreadDividerIndex(items, initialUnread, meId);
  // PERF-3: draw only the newest window of render items. The unread divider is
  // the anchor, so it is always drawn; a jump can widen the window (T-1278).
  const { windowItems, start, hasHidden, reveals, grow } = useMessageWindow(
    chatId,
    items,
    dividerIndex,
  );
  const {
    scrollRef,
    contentRef,
    dividerRef,
    atBottom,
    pending,
    loadingOlder,
    handleScroll,
    scrollToBottom,
  } = useMessageListScroll({
    chatId,
    chat,
    storeApi,
    items,
    visibleMessages,
    windowItems,
    reveals,
    hasHidden,
    grow,
    initialUnread,
    draftText,
  });

  // Loading and empty are different states: the empty and error views only
  // appear once the first history page has settled. Live messages that
  // arrive while loading are shown immediately.
  if (items.length === 0) {
    if (history === 'loading') {
      return (
        <div className="relative min-h-0 flex-1">
          <MessageListSkeleton />
        </div>
      );
    }
    if (history === 'error') {
      return (
        <div className="relative min-h-0 flex-1">
          <div
            className="chat-background flex h-full flex-col items-center justify-center p-8"
            style={backgroundStyle}
          >
            <StateMessage
              kind="error"
              title="Couldn't load messages"
              action={{ label: 'Retry', onClick: () => storeApi.getState().retryHistory(chat.id) }}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="relative min-h-0 flex-1">
        <div
          className="chat-background flex h-full items-center justify-center p-8 text-center"
          style={backgroundStyle}
        >
          <EmptyChat chat={chat} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <MessageAnnouncer messages={visibleMessages} meId={meId} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list"
        className="chat-background scrollbar-thin h-full overflow-y-auto"
        style={backgroundStyle}
      >
        <div
          ref={contentRef}
          className={`mx-auto flex w-full max-w-[860px] flex-col px-3 pt-4 wide:px-8 wide:pt-6 ${
            chat.topic !== undefined
              ? 'pb-[calc(var(--composer-h,0px)+3.5rem)]'
              : 'pb-[calc(var(--composer-h,0px)+1rem)] wide:pb-[calc(var(--composer-h,0px)+1.5rem)]'
          }`}
        >
          {loadingOlder && (
            <StateMessage kind="loading" title="Loading older messages" size="inline" />
          )}
          {windowItems.map((item, index) => (
            <MessageListRow
              key={messageRowKey(item, draftMessage?.id, draft?.turnId, finishedDraftMessages)}
              item={item}
              index={start + index}
              dividerIndex={dividerIndex}
              dividerRef={dividerRef}
              draftMessageId={draftMessage?.id}
              draftTurnId={draft?.turnId}
              finishedDraftMessages={finishedDraftMessages}
              chat={chat}
              meId={meId}
              meJid={meJid}
              pinId={item.kind === 'separator' ? undefined : pinIdByMessage.get(item.message.id)}
              onReply={handleReply}
              onForward={onForward === undefined ? undefined : handleForward}
              selectionIds={selectedIds}
              onToggleSelect={selection === undefined ? undefined : handleToggleSelect}
              onStartSelect={selection === undefined ? undefined : handleStartSelect}
              selecting={selecting}
            />
          ))}
        </div>
      </div>
      {!atBottom && (
        <IconButton
          aria-label={
            pending > 0 ? `Scroll to bottom, ${pending} new messages` : 'Scroll to bottom'
          }
          onClick={scrollToBottom}
          className="absolute right-4 bottom-[calc(var(--composer-h,0px)+1rem)]"
        >
          <ArrowDown className="size-5" aria-hidden="true" />
          {pending > 0 && <Badge count={pending} className="absolute -top-1 -right-1 px-1" />}
        </IconButton>
      )}
    </div>
  );
});
