import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { ArrowDown } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { DateSeparator } from './DateSeparator';
import { MessageBubble } from './MessageBubble';
import { MessageListSkeleton } from './Skeleton';
import { UnreadDivider } from './UnreadDivider';
import { IconButton } from './ui/icon-button';
import { Badge } from './ui/badge';
import { StateMessage } from './ui/state-message';
import { isBlockedSender, useBlockedJids } from '@/lib/blockedJids';
import { chatBackgroundStyle, effectiveBackground } from '@/lib/chatBackground';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

const NEAR_BOTTOM_PX = 80;

export function MessageList({
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
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  // T-0461: the chat's own background, else the caller's default, else slate
  // (which paints no inline style, exactly as before).
  const backgroundStyle = chatBackgroundStyle(
    effectiveBackground(store.chatPrefs[chat.id.toLowerCase()], store.defaultBackground),
  );
  const messages = store.messages(chat.id);
  // Unknown means never requested, which the real store reports as loading:
  // first paint (before ChatView's openChat effect runs) must never flash
  // the empty state.
  const history = store.historyStateFor(chat.id);
  const draft = store.drafts[chat.id];
  const draftText = draft?.text.trim() ?? '';
  const blockedJids = useBlockedJids();
  const meId = store.currentUserId;
  const hideBlocked = chat.kind === 'group' && chat.isAI !== true && blockedJids.size > 0;
  const visibleMessages = hideBlocked
    ? messages.filter(
        (message) => message.senderId === meId || !isBlockedSender(message.senderId, blockedJids),
      )
    : messages;
  // The draft is rendered as the AI's next message, so grouping, styles and
  // size are identical to the final message that replaces it.
  const draftMessage: UiMessage | undefined =
    draft !== undefined && draftText.length > 0
      ? {
          id: `draft-${draft.turnId}`,
          chatId: chat.id,
          senderId: chat.id,
          senderName: chat.title,
          text: draftText,
          createdAt: new Date(
            Math.max(new Date().getTime(), (messages.at(-1)?.createdAt.getTime() ?? 0) + 1),
          ),
          status: 'read',
        }
      : undefined;
  const items = groupMessages(
    draftMessage === undefined ? visibleMessages : [...visibleMessages, draftMessage],
  );
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
                  : store.finishedDraftMessages[item.message.id];
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
                    currentUserId={store.currentUserId}
                    meJid={store.me?.jid ?? undefined}
                    onReply={onReply}
                    {...(onForward === undefined ? {} : { onForward })}
                    selecting={selecting}
                    selected={selection !== undefined && selection.ids.has(item.message.id)}
                    {...(selection === undefined
                      ? {}
                      : {
                          onToggleSelect: selection.onToggle,
                          onStartSelect: selection.onStart,
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
}
