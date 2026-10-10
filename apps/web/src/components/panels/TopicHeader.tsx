import type { ChatSummary } from '@zilar/chat-core';
import { Lock, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

function visibilityLabel(visibility: 'public' | 'private'): string {
  return visibility === 'public' ? 'Public' : 'Private';
}

/** The topic sheet's header: avatar, group › title, visibility line and Close. */
export function TopicHeader({
  chat,
  visibility,
  groupTitle,
  suffix,
  onClose,
}: {
  chat: ChatSummary;
  visibility: 'public' | 'private';
  groupTitle: string;
  /** The member count text after the visibility, or ''. */
  suffix: string;
  onClose: () => void;
}) {
  const isPrivate = visibility === 'private';
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
      <Avatar id={chat.id} name={chat.title} size={44} avatarUrl={chat.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">
          {groupTitle !== '' && (
            <span className="font-normal text-muted-foreground">{groupTitle} › </span>
          )}
          {chat.title}
        </div>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {isPrivate && <Lock className="size-3" aria-hidden="true" />}
          {visibilityLabel(visibility)} topic
          {suffix}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Close topic panel"
        onClick={onClose}
        className="shrink-0 rounded-full text-muted-foreground"
      >
        <X className="size-5" aria-hidden="true" />
      </Button>
    </header>
  );
}
