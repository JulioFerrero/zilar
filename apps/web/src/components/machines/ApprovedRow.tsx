import { Effect } from 'effect';
import type { Machine } from '@/lib/api';
import { renameMachine, revokeMachine } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { isWaiting } from '@/lib/effect/use-action';
import { ApprovedMachineCard } from '@/components/machines/ApprovedMachineCard';
import { clearFailure, useMachineAction } from '@/components/machines/machineRowOps';

interface ApprovedRowProps {
  machine: Machine;
  confirmingRevoke: boolean;
  aiNames: string[] | null;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onAisChanged: () => void;
}

export function ApprovedRow({
  machine,
  confirmingRevoke,
  aiNames,
  onConfirm,
  onUpdate,
  onAisChanged,
}: ApprovedRowProps) {
  const [renameState, rename, , renameError] = useMachineAction(
    (name: string) =>
      Effect.sync(() => onUpdate(machine.id, { ...machine, name })).pipe(
        Effect.andThen(fromApi(() => renameMachine(machine.id, name))),
        Effect.tap((updated) => Effect.sync(() => onUpdate(machine.id, updated))),
        Effect.tapError(() => Effect.sync(() => onUpdate(machine.id, machine))),
      ),
    'Could not rename the machine.',
  );
  const [revokeState, revoke, revokeControls, revokeError] = useMachineAction(
    (id: string) =>
      fromApi(() => revokeMachine(id)).pipe(
        Effect.tap((updated) =>
          Effect.sync(() => {
            onAisChanged();
            onConfirm(null);
            onUpdate(id, updated);
          }),
        ),
      ),
    'Could not revoke the machine.',
  );

  const actionError = renameError ?? revokeError ?? '';

  return (
    <ApprovedMachineCard
      machine={machine}
      renaming={isWaiting(renameState)}
      revoking={isWaiting(revokeState)}
      confirmingRevoke={confirmingRevoke}
      actionError={actionError}
      aiNames={aiNames}
      onRename={(name) => rename(name)}
      onAskRevoke={() => {
        clearFailure(revokeState, revokeControls);
        onConfirm(machine.id);
      }}
      onCancelRevoke={() => {
        clearFailure(revokeState, revokeControls);
        onConfirm(null);
      }}
      onConfirmRevoke={() => revoke(machine.id)}
    />
  );
}
