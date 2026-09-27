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
import { UnreadDivider } from './UnreadDivider';
import { useChatStore } from '@/store/ChatStoreProvider';

const NEAR_BOTTOM_PX = 80;

export function MessageList({
  chat,
  onReply,
}: {
  chat: ChatSummary;
  onReply: (message: UiMessage) => void;
}) {
  const store = useChatStore();
  const messages = store.messages(chat.id);
  const items = groupMessages(messages);
  const [initialUnread] = useState(() => chat.unread);
  const dividerIndex = unreadDividerIndex(items, initialUnread);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef(messages.length);
  const [atBottom, setAtBottom] = useState(true);
  const [pending, setPending] = useState(0);

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
    if (atBottom) {
      element.scrollTop = element.scrollHeight;
    } else if (added > 0) {
      setPending((value) => value + added);
    }
  }, [messages.length, atBottom]);

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
  };

  const scrollToBottom = (): void => {
    const element = scrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
    setAtBottom(true);
    setPending(0);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list"
        className="chat-background scrollbar-thin h-full overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-[860px] flex-col px-3 pt-3 pb-4">
          {items.map((item, index) => (
            <Fragment key={item.kind === 'separator' ? item.id : item.message.id}>
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
                />
              )}
            </Fragment>
          ))}
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
