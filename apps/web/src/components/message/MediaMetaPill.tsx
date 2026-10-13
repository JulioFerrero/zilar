import type { UiMessage } from '@zilar/chat-core';
import { MessageMeta } from './MessageMeta';
import { cn } from '@/lib/utils';

/**
 * The dark translucent pill (T-1335): when a media message has no caption the
 * time and ticks sit on the photo, bottom-right, in white on
 * `rgba(0,0,0,0.45)`. The read ticks keep the bright seen colour.
 */
export function MediaMetaPill({
  message,
  showTicks,
  className,
}: {
  message: UiMessage;
  showTicks: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'absolute right-2 bottom-2 inline-flex items-center rounded-full bg-black/45 px-1.5 py-0.5 text-white',
        className,
      )}
    >
      <MessageMeta message={message} showTicks={showTicks} edited={message.edited === true} />
    </span>
  );
}
