import { QUICK_REACTIONS } from '@zilar/chat-core';
import { Forward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Menu, MenuItem } from './ui/menu';

export interface MessageActionsMenuProps {
  canCopy: boolean;
  /** True when the message can be edited (my own text message under 48 h). */
  canEdit: boolean;
  /** True when the message can be deleted for everyone (my own message). */
  canDelete: boolean;
  /** True when the caller may pin in this chat (DM either side, topic manager). */
  canPin: boolean;
  /** True when this message can be forwarded (not deleted, failed or sending). */
  canForward: boolean;
  /** True when this message is already pinned. */
  isPinned: boolean;
  onReply: () => void;
  onForward: () => void;
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

/** Reaction bar / Reply / Edit / Copy / Pin / Delete menu for a message bubble. */
export function MessageActionsMenu({
  canCopy,
  canEdit,
  canDelete,
  canPin,
  canForward,
  isPinned,
  onReply,
  onForward,
  onCopy,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onReact,
  onClose,
  align = 'right',
}: MessageActionsMenuProps) {
  return (
    <Menu
      open
      onClose={onClose}
      label="Message actions"
      closeLabel="Close message menu"
      backdropClassName="z-20"
      className={cn(
        'top-6 z-30 min-w-[196px] rounded-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]',
        align === 'right' ? 'right-0' : 'left-0',
      )}
    >
      <div className="flex items-center justify-between gap-0.5 px-2 pb-1">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
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
      <MenuItem onSelect={onReply}>Reply</MenuItem>
      {canForward && (
        <MenuItem onSelect={onForward} icon={Forward}>
          Forward
        </MenuItem>
      )}
      {canEdit && <MenuItem onSelect={onEdit}>Edit</MenuItem>}
      <MenuItem onSelect={onCopy} disabled={!canCopy}>
        Copy text
      </MenuItem>
      <MenuItem onSelect={onDelete} disabled={!canDelete} destructive>
        Delete for everyone
      </MenuItem>
      {canPin &&
        (isPinned ? (
          <MenuItem onSelect={onUnpin}>Unpin</MenuItem>
        ) : (
          <MenuItem onSelect={onPin}>Pin</MenuItem>
        ))}
    </Menu>
  );
}
