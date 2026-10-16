import {
  formatFullDateTime,
  formatTime,
  isAiJid,
  senderColor,
  type UiMessage,
} from '@zilar/chat-core';
import { AiBadge } from '../AiBadge';
import { MessageTicks } from '../MessageTicks';
import { cn } from '@/lib/utils';

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
      {edited && message.editedAt !== undefined ? (
        <span>edited {formatTime(message.editedAt)}</span>
      ) : (
        <>
          {edited && <span>edited</span>}
          {formatTime(message.createdAt)}
        </>
      )}
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
