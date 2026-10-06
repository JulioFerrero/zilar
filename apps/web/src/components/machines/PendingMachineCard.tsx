import { Check, X } from 'lucide-react';
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
 * The "New machine" card. Shows the runner's reported hardware, the public-key
 * fingerprint in mono so the owner can compare with what the runner shows, and
 * two keys: Approve (primary) and Deny (danger, two-step). The fingerprint
 * makes "is this really my new pair?" answerable in one glance.
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
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold">New machine</p>
          <p className="text-[14px] font-medium">{machine.name}</p>
        </div>
        <span className="rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
          pending
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

      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted-foreground">Fingerprint</span>
        <code className="rounded-md bg-well px-2 py-1 font-mono text-[13px] wrap-anywhere">
          {machine.fingerprint}
        </code>
        <p className="text-[13px] text-muted-foreground">
          Check that this matches what the runner shows.
        </p>
      </div>

      <p className="text-[13px] text-muted-foreground">
        Only approve a machine you just paired yourself.
      </p>

      {confirmingDeny && (
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
      )}

      {!confirmingDeny && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            aria-label={`Approve ${machine.name}`}
            disabled={approving || denying}
            onClick={onApprove}
          >
            <Check className="size-4" aria-hidden="true" />
            {approving ? 'Approving…' : 'Approve'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Deny ${machine.name}`}
            disabled={approving || denying}
            onClick={onAskDeny}
            className="text-danger hover:bg-danger/10 hover:text-danger"
          >
            <X className="size-4" aria-hidden="true" />
            Deny
          </Button>
        </div>
      )}

      {!confirmingDeny && actionError !== '' && <FieldError>{actionError}</FieldError>}
    </div>
  );
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
