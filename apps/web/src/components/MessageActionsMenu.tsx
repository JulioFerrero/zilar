import { QUICK_REACTIONS } from '@zilar/chat-core';
import { Forward, ListChecks } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Menu, MenuItem } from './ui/menu';

export interface MessageActionsMenuProps {
  canCopy: boolean;
  /** True when the message can be edited (my own text message under 48 h). */
  canEdit: boolean;
  /** True when the message can be deleted for everyone (my own message). */
  canDelete: boolean;
  /**
   * The delete item's label. In a DM it is "Delete" on my own message and
   * "Delete for me" on the peer's; everywhere else it stays
   * "Delete for everyone" (T-1247).
   */
  deleteLabel: string;
  /** True when the caller may pin in this chat (DM either side, topic manager). */
  canPin: boolean;
  /** True when this message can be forwarded (not deleted, failed or sending). */
  canForward: boolean;
  /** True when this message is already pinned. */
  isPinned: boolean;
  onReply: () => void;
  onForward: () => void;
  /** Enters multi-select mode with this message checked (T-0439). */
  onSelectMessages: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
  /** Which bubble edge the menu hangs from; incoming bubbles align left. */
  align?: 'left' | 'right';
  /**
   * A right-click point (viewport coordinates). When set, the menu opens at
   * the pointer instead of the bubble corner, kept inside the viewport (WUX-29).
   */
  point?: { x: number; y: number } | undefined;
}

/** Keeps a menu box at least this far from the viewport edges. */
const VIEWPORT_MARGIN = 8;
/** Fallback width when the menu is not measured yet (matches `min-w-[196px]`). */
const MENU_WIDTH = 196;

/** Reaction bar / Reply / Edit / Copy / Pin / Delete menu for a message bubble. */
export function MessageActionsMenu({
  canCopy,
  canEdit,
  canDelete,
  deleteLabel,
  canPin,
  canForward,
  isPinned,
  onReply,
  onForward,
  onSelectMessages,
  onCopy,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onReact,
  onClose,
  align = 'right',
  point,
}: MessageActionsMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(() => point ?? { x: 0, y: 0 });

  // Measure the open menu and clamp the pointer position so it stays fully
  // inside the viewport. Runs before paint, so the clamped spot is the first
  // one the user sees.
  useLayoutEffect(() => {
    if (point === undefined) {
      return;
    }
    const menu = wrapRef.current?.querySelector<HTMLElement>('[role="menu"]');
    const width = menu?.offsetWidth ?? MENU_WIDTH;
    const height = menu?.offsetHeight ?? 0;
    const x = Math.max(
      VIEWPORT_MARGIN,
      Math.min(point.x, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    const y = Math.max(
      VIEWPORT_MARGIN,
      Math.min(point.y, window.innerHeight - height - VIEWPORT_MARGIN),
    );
    setAt({ x, y });
  }, [point]);

  return (
    <div
      ref={wrapRef}
      className={point === undefined ? undefined : 'z-50'}
      style={point === undefined ? undefined : { position: 'fixed', left: at.x, top: at.y }}
    >
      <Menu
        open
        onClose={onClose}
        label="Message actions"
        closeLabel="Close message menu"
        backdropClassName="z-20"
        className={cn(
          'z-30 min-w-[196px] rounded-[12px] shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]',
          point === undefined
            ? cn('top-6', align === 'right' ? 'right-0' : 'left-0')
            : 'top-0 left-0',
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
          <>
            <MenuItem onSelect={onForward} icon={Forward}>
              Forward
            </MenuItem>
            <MenuItem onSelect={onSelectMessages} icon={ListChecks}>
              Select
            </MenuItem>
          </>
        )}
        {canEdit && <MenuItem onSelect={onEdit}>Edit</MenuItem>}
        <MenuItem onSelect={onCopy} disabled={!canCopy}>
          Copy text
        </MenuItem>
        <MenuItem onSelect={onDelete} disabled={!canDelete} destructive>
          {deleteLabel}
        </MenuItem>
        {canPin &&
          (isPinned ? (
            <MenuItem onSelect={onUnpin}>Unpin</MenuItem>
          ) : (
            <MenuItem onSelect={onPin}>Pin</MenuItem>
          ))}
      </Menu>
    </div>
  );
}
