import type { ChatSummary } from '@zilar/chat-core';
import { MoreHorizontal } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { ChatActionsMenu } from '../ChatActionsMenu';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';

type RowActionsProps = {
  chat: ChatSummary;
  isWide: boolean;
  menuOpen: boolean;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export function RowActions({ chat, isWide, menuOpen, setMenuOpen }: RowActionsProps) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Chat actions for ${chat.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen((value) => !value);
        }}
        className={cn(
          'pointer-events-none absolute top-1.5 size-6 shrink-0 bg-surface-raised text-subtle-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          isWide ? 'right-[10px]' : 'right-4',
        )}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </Button>
      {menuOpen && <ChatActionsMenu chat={chat} onClose={() => setMenuOpen(false)} />}
    </>
  );
}
