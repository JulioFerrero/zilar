import { Effect } from 'effect';
import type { Machine } from '@/lib/api';
import { approveMachine, denyMachine } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting } from '@/lib/effect/use-action';
import { PendingMachineCard } from '@/components/machines/PendingMachineCard';
import { clearFailure, useMachineAction } from '@/components/machines/machineRowOps';

interface PendingRowProps {
  machine: Machine;
  confirmingDeny: boolean;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onRemove: (id: string) => void;
}

/**
 * One pending machine with its own Approve and Deny actions, so two rows can
 * run at once while a second click on the same row waits for the first.
 */
export function PendingRow({
  machine,
  confirmingDeny,
  onConfirm,
  onUpdate,
  onRemove,
}: PendingRowProps) {
  const [approveState, approve, , approveError] = useMachineAction(
    (id: string) =>
      fromApi(() => approveMachine(id)).pipe(
        Effect.tap((updated) => Effect.sync(() => onUpdate(id, updated))),
      ),
    'Could not approve the machine.',
  );
  const [denyState, deny, denyControls, denyError] = useMachineAction(
    (id: string) =>
      fromApi(() => denyMachine(id)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            onRemove(id);
            onConfirm(null);
          }),
        ),
      ),
    'Could not deny the machine.',
  );

  const actionError = denyError ?? approveError ?? '';

  return (
    <PendingMachineCard
      machine={machine}
      approving={isWaiting(approveState)}
      denying={isWaiting(denyState)}
      confirmingDeny={confirmingDeny}
      actionError={actionError}
      onApprove={() => approve(machine.id)}
      onAskDeny={() => {
        clearFailure(denyState, denyControls);
        onConfirm(machine.id);
      }}
      onCancelDeny={() => {
        clearFailure(denyState, denyControls);
        onConfirm(null);
      }}
      onConfirmDeny={() => deny(machine.id)}
    />
  );
}
