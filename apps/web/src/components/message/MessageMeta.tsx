import { formatFullDateTime, formatTime, isAiJid, type UiMessage } from '@zilar/chat-core';
import { AiBadge } from '../AiBadge';
import { MessageTicks } from '../MessageTicks';
import { cn } from '@/lib/utils';

/** Monochrome-friendly sender name colors (ui-style.md §5). */
const SENDER_COLORS = ['#d4d4d4', '#a1a1a1', '#8a8a8a', '#ededed'] as const;

function senderColor(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return SENDER_COLORS[(hash >>> 0) % SENDER_COLORS.length] ?? SENDER_COLORS[0];
}

export function MessageMeta({
  message,
  showTicks,
  edited = false,
  className,
}: {
  message: UiMessage;
  showTicks: boolean;
  edited?: boolean;
  className?: string;
}) {
  return (
    <span
      title={formatFullDateTime(message.createdAt)}
      className={cn(
        'font-mono inline-flex items-center gap-0.5 text-[10px] tabular-nums',
        className,
      )}
    >
      {edited && <span>edited</span>}
      {formatTime(message.createdAt)}
      {showTicks && <MessageTicks status={message.status} />}
    </span>
  );
}

export function MessageSender({ message, className }: { message: UiMessage; className: string }) {
  return (
    <div
      className={cn('flex items-center gap-1.5 text-[14px] leading-5 font-semibold', className)}
      style={{ color: senderColor(message.senderId) }}
    >
      <span className="truncate">{message.senderName}</span>
      {isAiJid(message.senderId) && <AiBadge />}
    </div>
  );
}
