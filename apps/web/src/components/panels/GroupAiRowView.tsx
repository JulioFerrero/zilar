import type { ReactNode } from 'react';
import type { GroupAi } from '@/lib/api';
import { AiBadge } from '../AiBadge';
import { Avatar } from '../Avatar';
import { Button } from '../ui/button';

/**
 * The shared look of one AI row in a group or channel panel: avatar, name,
 * "Added by" line, an optional extra action and the Remove / confirm / Cancel
 * buttons. The panel owns the remove flow and passes it in.
 */
export function GroupAiRowView({
  ai,
  addedBy,
  extra,
  canRemove,
  confirming,
  busy,
  removeLabel,
  onAskRemove,
  onConfirmRemove,
  onCancel,
}: {
  ai: GroupAi;
  addedBy: string;
  extra?: ReactNode;
  canRemove: boolean;
  confirming: boolean;
  busy: boolean;
  removeLabel: string;
  onAskRemove: () => void;
  onConfirmRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover">
      <Avatar id={ai.jid} name={ai.name} size={32} ai avatarUrl={ai.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px]">{ai.name}</span>
          <AiBadge />
        </div>
        <p className="truncate text-[12px] text-muted-foreground">Added by {addedBy}</p>
      </div>
      {extra}
      {canRemove &&
        (confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              aria-label={`Confirm removing ${ai.name}`}
              disabled={busy}
              onClick={onConfirmRemove}
            >
              {busy ? 'Removing…' : 'Remove'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={removeLabel}
            className="shrink-0"
            onClick={onAskRemove}
          >
            Remove
          </Button>
        ))}
    </div>
  );
}
