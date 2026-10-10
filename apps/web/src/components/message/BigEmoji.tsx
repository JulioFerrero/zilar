import { type UiMessage } from '@zilar/chat-core';
import { cn } from '@/lib/utils';
import { MessageMeta } from './MessageMeta';

export function BigEmoji({
  message,
  text,
  own,
  generating = false,
}: {
  message: UiMessage;
  text: string;
  own: boolean;
  generating?: boolean;
}) {
  return (
    <div className={cn('flex flex-col', own ? 'items-end' : 'items-start')}>
      <span className="px-2 py-1 text-[48px] leading-none break-words">
        {text}
        {generating && <DraftCaret />}
      </span>
      <span
        className={cn(
          'raised-pill mt-1 rounded-full px-2 py-0.5 text-muted-foreground',
          generating && 'invisible',
        )}
      >
        <MessageMeta
          message={message}
          showTicks={own && !generating}
          edited={message.edited === true}
        />
      </span>
    </div>
  );
}

/**
 * A soft blinking caret at the end of a live draft. It has zero layout width
 * and paints into the trailing space, so swapping the draft for the final
 * message never moves the text.
 */
export function DraftCaret() {
  return (
    <span aria-hidden="true" className="relative inline-block h-[1em] w-0 align-[-0.15em]">
      <span className="absolute inset-y-0 left-0 w-0.5 animate-pulse bg-[#bdbdbd] motion-reduce:animate-none" />
    </span>
  );
}

/** The recessed `generating` label under a reply that is still being written. */
export function GeneratingLabel() {
  return (
    <span className="font-mono flex items-center gap-1.5 px-3 pt-1 pb-2 text-[11px] text-subtle-foreground">
      <span className="pulse-dot size-1.5 rounded-full bg-subtle-foreground" aria-hidden="true" />
      generating
    </span>
  );
}
