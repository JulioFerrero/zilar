import type { ReplyRef } from '@galena/chat-core';

export function ReplyQuote({ quote }: { quote: ReplyRef }) {
  return (
    <div className="mb-1 flex overflow-hidden rounded-md bg-surface/70">
      <span className="w-[3px] shrink-0 bg-[#333333]" aria-hidden="true" />
      <div className="min-w-0 px-2 py-1">
        <div className="truncate text-[13px] leading-4 font-semibold text-[#d4d4d4]">
          {quote.senderName}
        </div>
        {quote.text !== undefined && (
          <div className="truncate text-[13px] leading-4 text-muted-foreground">{quote.text}</div>
        )}
      </div>
    </div>
  );
}
