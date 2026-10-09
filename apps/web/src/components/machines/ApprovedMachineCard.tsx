import { useEffect, useRef, useState } from 'react';
import { Pencil, PowerOff } from 'lucide-react';
import type { Machine } from '@/lib/api';
import { FieldError } from '@/components/ais/AiPageShell';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { cn } from '@/lib/utils';
import { hardwareLine } from './PendingMachineCard';

interface ApprovedMachineCardProps {
  machine: Machine;
  renaming: boolean;
  revoking: boolean;
  confirmingRevoke: boolean;
  actionError: string;
  /** T-0091: names of the owner's AIs whose home machine is this one. When
   *  the AI list could not be loaded the prop is null and the line is
   *  hidden — a failure here never blocks the rest of the card. */
  aiNames: string[] | null;
  onRename: (name: string) => void;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
}

/**
 * An approved machine: name (inline rename), online dot, hardware, drivers,
 * fingerprint and a Revoke action that asks twice before disconnecting.
 * The card's heading is the machine's own name (with the rename pencil);
 * the section header above ("Your machines") names the group.
 */
export function ApprovedMachineCard({
  machine,
  renaming,
  revoking,
  confirmingRevoke,
  actionError,
  aiNames,
  onRename,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: ApprovedMachineCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(machine.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current !== null) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = (): void => {
    setDraft(machine.name);
    setEditing(true);
  };

  const cancelEdit = (): void => {
    setDraft(machine.name);
    setEditing(false);
  };

  // The page runs the rename and shows the new name at once, so the field
  // closes without waiting for the request.
  const commitEdit = (): void => {
    const next = draft.trim();
    if (next === '' || next === machine.name) {
      cancelEdit();
      return;
    }
    if (next.length > 64) {
      return;
    }
    onRename(next);
    setEditing(false);
  };

  const online = machine.online === true;
  const lastSeen = machine.lastSeenAt;
  const status = online
    ? 'Online'
    : lastSeen === null
      ? 'Never connected'
      : `Offline · last seen ${formatRelative(lastSeen)}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <TextInput
              ref={inputRef}
              aria-label={`Rename ${machine.name}`}
              value={draft}
              maxLength={64}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitEdit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelEdit();
                }
              }}
              onBlur={commitEdit}
              className="px-2 py-1 text-[16px] font-semibold"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-semibold">{machine.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Rename ${machine.name}`}
                title={`Rename ${machine.name}`}
                disabled={renaming || revoking}
                onClick={startEdit}
                className="text-muted-foreground"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px]',
            online
              ? 'bg-surface-raised text-foreground'
              : lastSeen === null
                ? 'bg-surface-raised text-muted-foreground'
                : 'bg-surface-raised text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block size-2 rounded-full',
              online ? 'bg-online' : 'bg-muted-foreground',
            )}
          />
          {status}
        </span>
      </div>

      <p className="font-mono text-[13px] text-muted-foreground wrap-anywhere">
        {hardwareLine(machine)}
      </p>

      {machine.drivers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {machine.drivers.map((driver) => (
            <span
              key={driver}
              className="rounded-full bg-badge-muted px-2 py-0.5 font-mono text-[11px] text-foreground"
            >
              {driver}
            </span>
          ))}
        </div>
      )}

      {/* T-0091: which of the owner's AIs live on this machine. The list
          comes from the same AI call the page already makes; a failure
          there just hides this line so the rest of the card stays usable. */}
      {aiNames !== null && (
        <p className="text-[13px] text-muted-foreground">
          {aiNames.length === 0 ? 'No AIs yet' : `AIs: ${aiNames.join(', ')}`}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted-foreground">Fingerprint</span>
        <code className="rounded-md bg-well px-2 py-1 font-mono text-[13px] wrap-anywhere">
          {machine.fingerprint}
        </code>
      </div>

      {confirmingRevoke && (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3">
          <p className="text-[13px] text-danger">
            Revoke {machine.name}? It will disconnect and must be paired again with a new code.
          </p>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onConfirmRevoke}
              disabled={renaming}
            >
              Revoke
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelRevoke}
              disabled={renaming}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!confirmingRevoke && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label={`Revoke ${machine.name}`}
            disabled={renaming || revoking || confirmingRevoke}
            onClick={onAskRevoke}
            className="text-danger hover:bg-danger/10 hover:text-danger"
          >
            <PowerOff className="size-4" aria-hidden="true" />
            Revoke
          </Button>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  if (Number.isNaN(then) || diffMs < 0) {
    return 'recently';
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}
