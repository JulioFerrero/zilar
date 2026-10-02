import { QUICK_REACTIONS } from '@zilar/chat-core';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface MessageActionsMenuProps {
  canCopy: boolean;
  /** True when the message can be edited (my own text message under 48 h). */
  canEdit: boolean;
  /** True when the message can be deleted for everyone (my own message). */
  canDelete: boolean;
  /** True when the caller may pin in this chat (DM either side, topic manager). */
  canPin: boolean;
  /** True when this message is already pinned. */
  isPinned: boolean;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
  /** Which bubble edge the menu hangs from; incoming bubbles align left. */
  align?: 'left' | 'right';
}

const ITEM_CLASS = 'flex w-full items-center px-3 py-2 text-left text-[15px]';

/** Reaction bar / Reply / Edit / Copy / Pin / Delete menu for a message bubble. */
export function MessageActionsMenu({
  canCopy,
  canEdit,
  canDelete,
  canPin,
  isPinned,
  onReply,
  onCopy,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onReact,
  onClose,
  align = 'right',
}: MessageActionsMenuProps) {
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
        className={cn(
          'absolute top-6 z-30 min-w-[196px] rounded-[12px] border border-border-strong bg-surface py-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <div className="flex items-center justify-between gap-0.5 px-2 pb-1">
          {QUICK_REACTIONS.map((emoji, index) => (
            <button
              key={emoji}
              ref={index === 0 ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              aria-label={`React with ${emoji}`}
              onClick={() => onReact(emoji)}
              className="key-icon flex size-7 items-center justify-center rounded-full text-[17px] leading-none focus-visible:outline-none"
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
        <button
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
        {canEdit && (
          <button
            type="button"
            role="menuitem"
            onClick={onEdit}
            className={cn(
              ITEM_CLASS,
              'hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none',
            )}
          >
            Edit
          </button>
        )}
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
        <button
          type="button"
          role="menuitem"
          disabled={!canDelete}
          onClick={onDelete}
          className={cn(
            ITEM_CLASS,
            'text-danger hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none disabled:opacity-50',
          )}
        >
          Delete for everyone
        </button>
        {canPin &&
          (isPinned ? (
            <button
              type="button"
              role="menuitem"
              onClick={onUnpin}
              className={cn(
                ITEM_CLASS,
                'hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none',
              )}
            >
              Unpin
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={onPin}
              className={cn(
                ITEM_CLASS,
                'hover:bg-list-hover focus-visible:bg-list-hover focus-visible:outline-none',
              )}
            >
              Pin
            </button>
          ))}
      </div>
    </>
  );
}
