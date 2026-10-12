import type { ReplyRef } from '@zilar/chat-core';

/**
 * The snapshot of a replied-to message above a bubble. With `onOpen` it is a
 * button that jumps to the original (WUX-13); without it, a plain block.
 */
export function ReplyQuote({ quote, onOpen }: { quote: ReplyRef; onOpen?: () => void }) {
  const content = (
    <>
      <span className="w-[3px] shrink-0 bg-[#333333]" aria-hidden="true" />
      <div className="min-w-0 px-2 py-1">
        <div className="truncate text-[13px] leading-4 font-semibold text-[#d4d4d4]">
          {quote.senderName}
        </div>
        {quote.text !== undefined && (
          <div className="truncate text-[13px] leading-4 text-muted-foreground">{quote.text}</div>
        )}
      </div>
    </>
  );

  if (onOpen === undefined) {
    return <div className="mb-1 flex overflow-hidden rounded-md bg-surface/70">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Go to the message from ${quote.senderName}`}
      className="mb-1 flex w-full overflow-hidden rounded-md bg-surface/70 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {content}
    </button>
  );
}
