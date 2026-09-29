import { useEffect, useRef, useState } from 'react';
import { Pencil, PowerOff } from 'lucide-react';
import type { Machine } from '@/lib/api';
import { FieldError } from '@/components/ais/AiPageShell';
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
  onRename: (name: string) => Promise<void> | void;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
}

/**
 * An approved machine: name (inline rename), online dot, hardware, drivers,
  fingerprint and a Revoke action that asks twice before disconnecting.
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

  const commitEdit = async (): Promise<void> => {
    const next = draft.trim();
    if (next === '' || next === machine.name) {
      cancelEdit();
      return;
    }
    if (next.length > 64) {
      return;
    }
    await onRename(next);
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
            <input
              ref={inputRef}
              aria-label={`Rename ${machine.name}`}
              value={draft}
              maxLength={64}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitEdit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelEdit();
                }
              }}
              onBlur={() => void commitEdit()}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-[16px] font-semibold outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-semibold">{machine.name}</span>
              <button
                type="button"
                aria-label={`Rename ${machine.name}`}
                disabled={renaming || revoking}
                onClick={startEdit}
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>
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

      <p className="font-mono text-[13px] text-muted-foreground">{hardwareLine(machine)}</p>

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
        <span className="text-[12px] text-muted-foreground">Fingerprint</span>
        <code className="rounded-md bg-well px-2 py-1 font-mono text-[13px]">
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
            <button
              type="button"
              onClick={onConfirmRevoke}
              disabled={renaming}
              className="rounded-full bg-danger px-3 py-1.5 text-[14px] font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              Revoke
            </button>
            <button
              type="button"
              onClick={onCancelRevoke}
              disabled={renaming}
              className="rounded-full px-3 py-1.5 text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!confirmingRevoke && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Revoke ${machine.name}`}
            disabled={renaming || revoking || confirmingRevoke}
            onClick={onAskRevoke}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[14px] text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            <PowerOff className="size-4" aria-hidden="true" />
            Revoke
          </button>
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
