import type { Machine } from '@/lib/api';
import { FieldError } from '@/components/ais/AiPageShell';
import { Button } from '@/components/ui/button';

interface PendingMachineCardProps {
  machine: Machine;
  approving: boolean;
  denying: boolean;
  confirmingDeny: boolean;
  actionError: string;
  onApprove: () => void;
  onAskDeny: () => void;
  onCancelDeny: () => void;
  onConfirmDeny: () => void;
}

/**
 * The "new machine" card (T-1518): an amber waiting dot and the name, the
 * public-key fingerprint in a big mono well so the owner compares it with what
 * the runner shows, then Deny and Approve. The hardware, the drivers and the
 * sandbox chips live on the machine's own page now.
 */
export function PendingMachineCard({
  machine,
  approving,
  denying,
  confirmingDeny,
  actionError,
  onApprove,
  onAskDeny,
  onCancelDeny,
  onConfirmDeny,
}: PendingMachineCardProps) {
  return (
    <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span
          role="img"
          aria-label="Waiting"
          className="size-2 shrink-0 rounded-full bg-amber-500"
        />
        <span className="text-[15px] font-semibold">{machine.name}</span>
      </div>

      <code className="flex h-11 items-center justify-center rounded-[10px] bg-well px-3 font-mono text-[16px] tracking-[0.08em] wrap-anywhere">
        {groupFingerprint(machine.fingerprint)}
      </code>

      {confirmingDeny ? (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3">
          <p className="text-[13px] text-danger">
            Deny {machine.name}? The pairing is cancelled and the runner will not be added.
          </p>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onConfirmDeny}
              disabled={denying}
            >
              Deny
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelDeny}
              disabled={denying}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] text-muted-foreground">
              Approve if the machine shows this code.
            </span>
            <Button
              type="button"
              variant="outline"
              aria-label={`Deny ${machine.name}`}
              disabled={approving || denying}
              onClick={onAskDeny}
            >
              Deny
            </Button>
            <Button
              type="button"
              aria-label={`Approve ${machine.name}`}
              disabled={approving || denying}
              onClick={onApprove}
            >
              {approving ? 'Approving…' : 'Approve'}
            </Button>
          </div>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </>
      )}
    </div>
  );
}

/** Groups the raw fingerprint in fours for display (`a1b2 c3d4 e5f6 0718`). */
function groupFingerprint(value: string): string {
  return value.replace(/(.{4})(?=.)/g, '$1 ');
}

export function hardwareLine(machine: Machine): string {
  const cpu = machine.cpu.length > 36 ? `${machine.cpu.slice(0, 33)}…` : machine.cpu;
  return [
    machine.os,
    machine.osVersion,
    machine.arch,
    cpu,
    `${machine.cores} ${machine.cores === 1 ? 'core' : 'cores'}`,
    `${machine.ramGb} GB RAM`,
  ].join(' · ');
}
