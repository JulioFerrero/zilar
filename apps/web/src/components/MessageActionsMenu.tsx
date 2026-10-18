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
  /** True when the message is mine, text, and under 48 h. */
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  deleteLabel: string;
  /** True when the caller may pin: DM either side, topic manager. */
  canPin: boolean;
  canForward: boolean;
  canDownload: boolean;
  isPinned: boolean;
  onReply: () => void;
  onForward: () => void;
  onDownload: () => void;
  onSelectMessages: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onReact: (emoji: string) => void;
  onMoreReactions?: (() => void) | undefined;
  onClose: () => void;
  align?: 'left' | 'right';
  /** A right-click point (viewport); Base UI shifts the menu back inside the viewport. */
  point?: { x: number; y: number } | undefined;
}

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
            anchorClassName: right ? 'absolute top-6 right-0' : 'absolute top-6 left-0',
          }
        : {
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
