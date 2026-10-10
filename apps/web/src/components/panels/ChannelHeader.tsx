import type { ChatSummary } from '@zilar/chat-core';
import { Megaphone, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

/** The channel sheet's header: avatar, title, subscriber count and Close. */
export function ChannelHeader({
  chat,
  count,
  onClose,
}: {
  chat: ChatSummary;
  count: number;
  onClose: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
      <Avatar id={chat.id} name={chat.title} size={44} avatarUrl={chat.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-[16px] font-semibold">{chat.title}</div>
          <Megaphone aria-label="Channel" className="size-4 shrink-0 text-subtle-foreground" />
        </div>
        <p className="text-[13px] text-muted-foreground">
          {count} {count === 1 ? 'subscriber' : 'subscribers'}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Close channel panel"
        onClick={onClose}
        className="shrink-0 rounded-full text-muted-foreground"
      >
        <X className="size-5" aria-hidden="true" />
      </Button>
    </header>
  );
}
