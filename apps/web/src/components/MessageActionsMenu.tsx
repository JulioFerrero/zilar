import { QUICK_REACTIONS } from '@zilar/chat-core';
import {
  Copy,
  Download,
  Forward,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Reply,
  Trash2,
} from 'lucide-react';
import { Menu, MenuEntry, MenuItem } from './ui/menu';

export interface MessageActionsMenuProps {
  canCopy: boolean;
  /** True when the message can be edited (my own text message under 48 h). */
  canEdit: boolean;
  /** True when the message can be deleted for everyone (my own message). */
  canDelete: boolean;
  /** True when the message can be named on the wire for a reaction (UI-7). */
  canReact: boolean;
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
  /** True when this message carries a downloadable `kind: 'file'` attachment (T-1325). */
  canDownload: boolean;
  /** True when this message is already pinned. */
  isPinned: boolean;
  onReply: () => void;
  onForward: () => void;
  /** Saves the message's file attachment (T-1325). */
  onDownload: () => void;
  /** Enters multi-select mode with this message checked (T-0439). */
  onSelectMessages: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onReact: (emoji: string) => void;
  /** Opens the full emoji picker (T-1933). The + key is drawn only when given. */
  onMoreReactions?: (() => void) | undefined;
  onClose: () => void;
  /** Which bubble edge the menu hangs from; incoming bubbles align left. */
  align?: 'left' | 'right';
  /**
   * A right-click point (viewport coordinates). When set, the menu opens at
   * the pointer instead of the bubble corner (WUX-29); Base UI shifts it back
   * inside the viewport when the point is near an edge.
   */
  point?: { x: number; y: number } | undefined;
}

/** Reaction bar / Reply / Edit / Copy / Download / Pin / Delete menu for a message bubble. */
export function MessageActionsMenu({
  canCopy,
  canEdit,
  canDelete,
  canReact,
  deleteLabel,
  canPin,
  canForward,
  canDownload,
  isPinned,
  onReply,
  onForward,
  onDownload,
  onSelectMessages,
  onCopy,
  onEdit,
  onDelete,
  onPin,
  onUnpin,
  onReact,
  onMoreReactions,
  onClose,
  align = 'right',
  point,
}: MessageActionsMenuProps) {
  const right = align === 'right';
  return (
    <Menu
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      label="Message actions"
      align={point === undefined ? (right ? 'end' : 'start') : 'start'}
      sideOffset={0}
      {...(point === undefined
        ? {
            // No trigger of its own: the bubble's ⋯ button lives in the parent
            // and manages `open`. The invisible anchor sits where the old panel
            // was placed (below the button, `top-6`).
            anchorClassName: right ? 'absolute top-6 right-0' : 'absolute top-6 left-0',
          }
        : {
            // A right-click anchor at the pointer; Base UI keeps the panel
            // inside the viewport near an edge.
            point,
          })}
    >
      <div className="flex items-center justify-between gap-0.5 px-2 pb-1">
        {QUICK_REACTIONS.map((emoji) => (
          <MenuEntry
            key={emoji}
            ariaLabel={`React with ${emoji}`}
            disabled={!canReact}
            onSelect={() => onReact(emoji)}
            className="key-icon flex size-7 items-center justify-center rounded-full text-[17px] leading-none"
          >
            <span aria-hidden="true">{emoji}</span>
          </MenuEntry>
        ))}
        {onMoreReactions !== undefined && (
          <MenuEntry
            ariaLabel="More reactions"
            disabled={!canReact}
            onSelect={onMoreReactions}
            className="key-icon flex size-7 items-center justify-center rounded-full text-muted-foreground"
          >
            <Plus className="size-4" aria-hidden="true" />
          </MenuEntry>
        )}
      </div>
      <MenuItem onSelect={onReply} icon={Reply}>
        Reply
      </MenuItem>
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
      {canEdit && (
        <MenuItem onSelect={onEdit} icon={Pencil}>
          Edit
        </MenuItem>
      )}
      <MenuItem onSelect={onCopy} disabled={!canCopy} icon={Copy}>
        Copy text
      </MenuItem>
      {canDownload && (
        <MenuItem onSelect={onDownload} icon={Download}>
          Download
        </MenuItem>
      )}
      <MenuItem onSelect={onDelete} disabled={!canDelete} destructive icon={Trash2}>
        {deleteLabel}
      </MenuItem>
      {canPin &&
        (isPinned ? (
          <MenuItem onSelect={onUnpin} icon={PinOff}>
            Unpin
          </MenuItem>
        ) : (
          <MenuItem onSelect={onPin} icon={Pin}>
            Pin
          </MenuItem>
        ))}
    </Menu>
  );
}
