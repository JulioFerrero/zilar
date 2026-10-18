import { replyQuoteContent, senderColor, type UiMessage } from '@zilar/chat-core';
import { useChatSelector } from '@/store/ChatStoreProvider';

/** Our own replies keep the accent instead of a sender colour. */
const ACCENT = 'var(--accent)';

export function ReplyQuote({ message, onOpen }: { message: UiMessage; onOpen?: () => void }) {
  const quote = message.replyTo;
  // The wire reply carries no name: resolve the target from the loaded history.
  const referenced = useChatSelector((state) =>
    quote === undefined
      ? undefined
      : state.messagesByChat[message.chatId]?.find((item) => item.id === quote.id),
  );
  const currentUserId = useChatSelector((state) => state.currentUserId);
  if (quote === undefined) {
    return null;
  }
  const content = replyQuoteContent(quote, referenced, currentUserId);
  if (content === undefined) {
    return null;
  }
  const color = content.own ? ACCENT : senderColor(content.senderId);

  const block = (
    <>
      <span className="w-[3px] shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="min-w-0 px-2 py-1">
        <div className="truncate text-[13px] leading-4 font-semibold" style={{ color }}>
          {content.senderName}
        </div>
        {content.text !== undefined && (
          <div className="truncate text-[13px] leading-4 text-muted-foreground">{content.text}</div>
        )}
      </div>
    </>
  );

  if (onOpen === undefined) {
    return <div className="mb-1 flex overflow-hidden rounded-md bg-surface/70">{block}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Go to the message from ${content.senderName}`}
      className="mb-1 flex w-full overflow-hidden rounded-md bg-surface/70 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {block}
    </button>
  );
}
