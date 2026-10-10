import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { ArrowDown } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateSeparator } from './DateSeparator';
import { MessageBubble } from './MessageBubble';
import { MessageListSkeleton } from './Skeleton';
import { UnreadDivider } from './UnreadDivider';
import { IconButton } from './ui/icon-button';
import { Badge } from './ui/badge';
import { StateMessage } from './ui/state-message';
import { isBlockedSender, useBlockedJids } from '@/lib/blockedJids';
import { chatBackgroundStyle, effectiveBackground } from '@/lib/chatBackground';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';

const NEAR_BOTTOM_PX = 80;
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
  const dividerIndex = unreadDividerIndex(items, initialUnread);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(visibleMessages.length);
  const prependScrollHeight = useRef<number | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(atBottom);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  useEffect(() => {
    const element = scrollRef.current;
    const divider = dividerRef.current;
    if (element === null) {
      return;
    }
    if (divider !== null) {
      divider.scrollIntoView({ block: 'center' });
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const added = visibleMessages.length - previousCount.current;
    previousCount.current = visibleMessages.length;
    const previousHeight = prependScrollHeight.current;
    if (previousHeight !== undefined) {
      prependScrollHeight.current = undefined;
      element.scrollTop += element.scrollHeight - previousHeight;
      return;
    }
    if (atBottom) {
      element.scrollTop = element.scrollHeight;
    } else if (added > 0) {
      setPending((value) => value + added);
    }
  }, [visibleMessages.length, atBottom]);

  // A growing draft keeps the view pinned to the bottom only when the user is
  // already there; someone who scrolled up to read is never pulled down.
  useEffect(() => {
    if (draftText.length === 0) {
      return;
    }
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    if (atBottom) {
      element.scrollTop = element.scrollHeight;
    }
  }, [draftText, atBottom]);

  // The reveal grows the text frame by frame, so the per-event pin above is
  // not enough: the observer keeps the view at the bottom on every height
  // change, as long as the user is there.
  const hasContent = items.length > 0;
  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!hasContent || element === null || content === null) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasContent]);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nearBottom = distance < NEAR_BOTTOM_PX;
    setAtBottom(nearBottom);
    if (nearBottom) {
      setPending(0);
    }
    const store = storeApi.getState();
    if (element.scrollTop < NEAR_BOTTOM_PX && store.hasMore(chat.id)) {
      prependScrollHeight.current = element.scrollHeight;
      store.loadOlder(chat.id);
    }
  };

  const scrollToBottom = (): void => {
    const element = scrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
    setAtBottom(true);
    setPending(0);
  };

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
          <StateMessage kind="empty" title="No messages yet" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list"
        className="chat-background scrollbar-thin h-full overflow-y-auto"
        style={backgroundStyle}
      >
        <div
          ref={contentRef}
          className="mx-auto flex w-full max-w-[860px] flex-col px-3 py-4 wide:px-8 wide:py-6"
        >
          {items.map((item, index) => {
            const isDraft = item.kind === 'message' && item.message.id === draftMessage?.id;
            // The final message keeps the draft's key so React reuses the same
            // bubble and its reveal carries on instead of snapping.
            const revealTurnId =
              item.kind === 'separator'
                ? undefined
                : isDraft
                  ? draft?.turnId
                  : finishedDraftMessages[item.message.id];
            const key =
              item.kind === 'separator'
                ? item.id
                : revealTurnId === undefined
                  ? item.message.id
                  : `draft-${revealTurnId}`;
            return (
              <Fragment key={key}>
                {dividerIndex === index && <UnreadDivider ref={dividerRef} />}
                {item.kind === 'separator' ? (
                  <DateSeparator date={item.date} />
                ) : (
                  <MessageBubble
                    message={item.message}
                    chat={chat}
                    firstInGroup={item.firstInGroup}
                    lastInGroup={item.lastInGroup}
                    currentUserId={meId}
                    meJid={meJid}
                    onReply={handleReply}
                    {...(onForward === undefined ? {} : { onForward: handleForward })}
                    selecting={selecting}
                    selected={selectedIds !== undefined && selectedIds.has(item.message.id)}
                    {...(selection === undefined
                      ? {}
                      : {
                          onToggleSelect: handleToggleSelect,
                          onStartSelect: handleStartSelect,
                        })}
                    draft={isDraft}
                    {...(revealTurnId === undefined ? {} : { revealTurnId })}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      {!atBottom && (
        <IconButton
          aria-label={
            pending > 0 ? `Scroll to bottom, ${pending} new messages` : 'Scroll to bottom'
          }
          onClick={scrollToBottom}
          className="absolute right-4 bottom-4"
        >
          <ArrowDown className="size-5" aria-hidden="true" />
          {pending > 0 && <Badge count={pending} className="absolute -top-1 -right-1 px-1" />}
        </IconButton>
      )}
    </div>
  );
});
