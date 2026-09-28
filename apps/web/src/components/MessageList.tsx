import {
  groupMessages,
  unreadDividerIndex,
  type ChatSummary,
  type UiMessage,
} from '@galena/chat-core';
import { ArrowDown } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { DateSeparator } from './DateSeparator';
import { MessageBubble } from './MessageBubble';
import { MessageListSkeleton } from './Skeleton';
import { UnreadDivider } from './UnreadDivider';
import { Button } from './ui/button';
import { useChatStore, useChatStoreApi } from '@/store/ChatStoreProvider';

const NEAR_BOTTOM_PX = 80;

export function MessageList({
  chat,
  onReply,
}: {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
}) {
  const store = useChatStore();
  const storeApi = useChatStoreApi();
  const messages = store.messages(chat.id);
  // Unknown means never requested, which the real store reports as loading:
  // first paint (before ChatView's openChat effect runs) must never flash
  // the empty state.
  const history = store.historyStateFor(chat.id);
  const draft = store.drafts[chat.id];
  const draftText = draft?.text.trim() ?? '';
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
  const items = groupMessages(draftMessage === undefined ? messages : [...messages, draftMessage]);
  const [initialUnread] = useState(() => chat.unread);
  const dividerIndex = unreadDividerIndex(items, initialUnread);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(messages.length);
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
    const added = messages.length - previousCount.current;
    previousCount.current = messages.length;
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
  }, [messages.length, atBottom]);

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
          <div className="chat-background flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-[15px] text-muted-foreground">{"Couldn't load messages"}</p>
            <Button
              type="button"
              size="lg"
              className="rounded-full px-5"
              onClick={() => storeApi.getState().retryHistory(chat.id)}
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="relative min-h-0 flex-1">
        <div className="chat-background flex h-full items-center justify-center p-8 text-center">
          <p className="text-[15px] text-muted-foreground">No messages yet</p>
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
      >
        <div ref={contentRef} className="mx-auto flex w-full max-w-[860px] flex-col px-3 pt-3 pb-4">
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
                    onReply={onReply}
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
        <button
          type="button"
          aria-label={
            pending > 0 ? `Scroll to bottom, ${pending} new messages` : 'Scroll to bottom'
          }
          onClick={scrollToBottom}
          className="absolute right-4 bottom-4 flex size-11 items-center justify-center rounded-full bg-background shadow-lg"
        >
          <ArrowDown className="size-5 text-muted-foreground" aria-hidden="true" />
          {pending > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-semibold text-accent-foreground">
              {pending}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
