import { MoreHorizontal } from 'lucide-react';
import type { RefObject } from 'react';
import { Button } from '../ui/button';
import { MessageMenuBody, type MessageMenuProps } from './MessageMenuBody';
import { useMessageMenu } from './use-message-menu';
import { cn } from '@/lib/utils';

export type { MessageMenuProps };

export function MessageActionsButton({
  buttonRef,
  open,
  onOpen,
  beside,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpen: () => void;
  beside?: 'left' | 'right' | undefined;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Message actions"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onOpen}
      className={cn(
        'absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        beside === 'left' && 'top-1/2 right-auto -left-7 -translate-y-1/2',
        beside === 'right' && 'top-1/2 -right-7 -translate-y-1/2',
      )}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </Button>
  );
}

export function MessageMenu(props: MessageMenuProps) {
  const menu = useMessageMenu();
  if (!props.open && !menu.confirmOpen && !menu.pickerOpen) {
    return null;
  }
  return <MessageMenuBody {...props} menu={menu} />;
}
