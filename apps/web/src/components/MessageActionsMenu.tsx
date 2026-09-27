import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface MessageActionsMenuProps {
  canCopy: boolean;
  onReply: () => void;
  onCopy: () => void;
  onClose: () => void;
}

const ITEM_CLASS = 'flex w-full items-center px-3 py-2 text-left text-[15px]';

/** Reply / Copy / Delete menu for a message bubble, opened by right-click or the ⋯ button. */
export function MessageActionsMenu({ canCopy, onReply, onCopy, onClose }: MessageActionsMenuProps) {
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close message menu"
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        role="menu"
        aria-label="Message actions"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        className="absolute top-6 right-0 z-30 min-w-[160px] rounded-xl border border-divider bg-popover py-1 shadow-lg"
      >
        <button
          ref={firstItemRef}
          type="button"
          role="menuitem"
          onClick={onReply}
          className={cn(
            ITEM_CLASS,
            'hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none',
          )}
        >
          Reply
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={!canCopy}
          onClick={onCopy}
          className={cn(
            ITEM_CLASS,
            'hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none disabled:opacity-50',
          )}
        >
          Copy text
        </button>
        <button type="button" role="menuitem" disabled className={cn(ITEM_CLASS, 'opacity-50')}>
          Delete
        </button>
      </div>
    </>
  );
}
