import { Effect } from 'effect';
import type { Machine } from '@/lib/api';
import { deleteMachine } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { isWaiting } from '@/lib/effect/use-action';
import { RevokedMachineCard } from '@/components/machines/RevokedMachineCard';
import { clearFailure, useMachineAction } from '@/components/machines/machineRowOps';

interface RevokedRowProps {
  machine: Machine;
  confirmingDelete: boolean;
  onConfirm: (id: string | null) => void;
  onRemove: (id: string) => void;
}

/** One revoked machine with its own delete action. */
export function RevokedRow({ machine, confirmingDelete, onConfirm, onRemove }: RevokedRowProps) {
  const [deleteState, deleteMachineRow, deleteControls, deleteError] = useMachineAction(
    (id: string) =>
      fromApi(() => deleteMachine(id)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            onRemove(id);
            onConfirm(null);
          }),
        ),
      ),
    'Could not delete the machine.',
  );

  const actionError = deleteError ?? '';

  return (
    <RevokedMachineCard
      machine={machine}
      deleting={isWaiting(deleteState)}
      confirmingDelete={confirmingDelete}
      actionError={actionError}
      onAskDelete={() => {
        clearFailure(deleteState, deleteControls);
        onConfirm(machine.id);
      }}
      onCancelDelete={() => {
        clearFailure(deleteState, deleteControls);
        onConfirm(null);
      }}
      onConfirmDelete={() => deleteMachineRow(machine.id)}
    />
  );
}
