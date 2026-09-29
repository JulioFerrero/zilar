import { Trash2 } from 'lucide-react';
import type { Machine } from '@/lib/api';
import { FieldError } from '@/components/ais/AiPageShell';
import { hardwareLine } from './PendingMachineCard';

interface RevokedMachineCardProps {
  machine: Machine;
  deleting: boolean;
  confirmingDelete: boolean;
  actionError: string;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

/** A revoked machine, kept muted in a collapsed section. Delete is destructive. */
export function RevokedMachineCard({
  machine,
  deleting,
  confirmingDelete,
  actionError,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: RevokedMachineCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-divider bg-surface/60 p-4 opacity-80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{machine.name}</p>
          <p className="text-[12px] text-muted-foreground">{hardwareLine(machine)}</p>
        </div>
        <span className="rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          Revoked
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Revoked {formatRevokedAt(machine.approvedAt ?? machine.createdAt)}
      </p>

      {confirmingDelete ? (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3">
          <p className="text-[13px] text-danger">Delete {machine.name}? This is permanent.</p>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={deleting}
              className="rounded-full bg-danger px-3 py-1.5 text-[14px] font-medium text-white hover:bg-danger/90 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              disabled={deleting}
              className="rounded-full px-3 py-1.5 text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Delete ${machine.name}`}
            onClick={onAskDelete}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[14px] text-danger hover:bg-danger/10"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </button>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </div>
      )}
    </div>
  );
}

function formatRevokedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    date,
  );
}
