import { useMemo, useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useNavigate } from 'react-router';
import { ChevronDown, Plus, Server } from 'lucide-react';
import {
  ApiError,
  approveMachine,
  deleteMachine,
  denyMachine,
  listAis,
  listMachines,
  renameMachine,
  revokeMachine,
} from '@/lib/api';
import type { Machine, PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import {
  failureOf,
  isWaiting,
  useAction,
  type ActionControls,
  type ActionState,
} from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button } from '@/components/ais/AiPageShell';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { StateMessage } from '@/components/ui/state-message';
import { AddMachineDialog } from '@/components/machines/AddMachineDialog';
import { ApprovedMachineCard } from '@/components/machines/ApprovedMachineCard';
import { MachineListSkeleton } from '@/components/machines/MachineListSkeleton';
import { PendingMachineCard } from '@/components/machines/PendingMachineCard';
import { RevokedMachineCard } from '@/components/machines/RevokedMachineCard';
import { machineErrorMessage } from '@/components/machines/errors';

type PageStatus = 'loading' | 'ready' | 'error';

interface ConfirmingState {
  deny: string | null;
  revoke: string | null;
  delete: string | null;
}

type ConfirmKind = keyof ConfirmingState;

const EMPTY_CONFIRMING: ConfirmingState = { deny: null, revoke: null, delete: null };

/** Settings → Machines. List, add, approve/deny, rename, revoke, delete. */
export function MachinesPage() {
  const navigate = useNavigate();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmingState>(EMPTY_CONFIRMING);
  const [showRevoked, setShowRevoked] = useState(false);
  // T-0091: the owner's AIs, used to label each approved machine card with
  // the AIs whose home machine it is. `null` means the load failed: the
  // card hides its "AIs: …" line and the rest of the page keeps working.
  const [ais, setAis] = useState<PublicAi[] | null>(null);

  const [loadState, reload] = useQuery(
    () =>
      fromApi(() => listMachines()).pipe(
        Effect.tap((list) => Effect.sync(() => setMachines(list))),
      ),
    [],
  );

  // T-0091: load the owner's AIs so the approved machine card can list
  // "AIs: A, B". The load is independent of the machines load: a failure
  // here just hides the line on each card, never blocks the page. A refresh
  // that fails keeps the list it had.
  const loadAis = fromApi(() => listAis()).pipe(
    Effect.tap((list) => Effect.sync(() => setAis(list))),
    Effect.catchTag('ApiFailure', () => Effect.void),
  );
  useQuery(() => loadAis, []);
  const [, refreshAis] = useAction<void, void, never>(() => loadAis, { mode: 'replace' });

  const replaceMachine = (id: string, next: Machine): void => {
    setMachines((previous) => previous.map((m) => (m.id === id ? next : m)));
  };

  const removeMachine = (id: string): void => {
    setMachines((previous) => previous.filter((m) => m.id !== id));
  };

  const setConfirm = (kind: ConfirmKind, id: string | null): void => {
    setConfirming((c) => ({ ...c, [kind]: id }));
  };

  const pendingMachines = machines.filter((m) => m.status === 'pending');
  const approvedMachines = machines.filter((m) => m.status === 'approved');
  const revokedMachines = machines.filter((m) => m.status === 'revoked');

  // T-0091: when an AI's home is unassigned (e.g. on revoke), the server
  // returns a fresh AI; keep the local AI list in step so the card drops
  // the AI's name right away. `ais` being null means the load failed and
  // we skip the lookup entirely — the card hides its "AIs: …" line.
  const aisByMachineId = useMemo(() => {
    const map = new Map<string, string[]>();
    if (ais === null) {
      return map;
    }
    for (const ai of ais) {
      if (ai.machineId !== null && ai.machineId !== undefined) {
        const list = map.get(ai.machineId) ?? [];
        list.push(ai.name);
        map.set(ai.machineId, list);
      }
    }
    return map;
  }, [ais]);

  const loading = isWaiting(loadState) || AsyncResult.isInitial(loadState);
  const status: PageStatus = loading
    ? 'loading'
    : AsyncResult.isFailure(loadState)
      ? 'error'
      : 'ready';
  const loadError =
    status === 'error' ? failureText(failureOf(loadState), 'Could not load your machines.') : '';

  return (
    <SettingsShell
      title="Machines"
      subtitle="Computers where your AIs can work."
      onBack={() => navigate('/')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && <MachineListSkeleton />}

        {status === 'error' && (
          <StateMessage
            kind="error"
            title={loadError}
            action={{ label: 'Retry', onClick: reload }}
          />
        )}

        {status === 'ready' && (
          <>
            {machines.length === 0 ? (
              <StateMessage
                kind="empty"
                icon={Server}
                title="No machines yet."
                hint="Add one to let your AIs work on your own computers."
                action={{ label: 'Add machine', onClick: () => setAdding(true) }}
              />
            ) : (
              <>
                {pendingMachines.length > 0 && (
                  <section aria-label="Waiting for approval" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-[16px] font-semibold">Waiting for approval</h2>
                      <Button
                        type="button"
                        size="lg"
                        className="rounded-full px-5"
                        onClick={() => setAdding(true)}
                      >
                        <Plus aria-hidden="true" />
                        Add machine
                      </Button>
                    </div>
                    <ul className="flex flex-col gap-2">
                      {pendingMachines.map((machine) => (
                        <li key={machine.id}>
                          <PendingRow
                            machine={machine}
                            confirmingDeny={confirming.deny === machine.id}
                            onConfirm={(id) => setConfirm('deny', id)}
                            onUpdate={replaceMachine}
                            onRemove={removeMachine}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {approvedMachines.length > 0 && (
                  <section aria-label="Your machines" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-[16px] font-semibold">Your machines</h2>
                      {pendingMachines.length === 0 && (
                        <Button
                          type="button"
                          size="lg"
                          className="rounded-full px-5"
                          onClick={() => setAdding(true)}
                        >
                          <Plus aria-hidden="true" />
                          Add machine
                        </Button>
                      )}
                    </div>
                    <ul className="flex flex-col gap-2">
                      {approvedMachines.map((machine) => (
                        <li key={machine.id}>
                          <ApprovedRow
                            machine={machine}
                            confirmingRevoke={confirming.revoke === machine.id}
                            aiNames={ais === null ? null : (aisByMachineId.get(machine.id) ?? [])}
                            onConfirm={(id) => setConfirm('revoke', id)}
                            onUpdate={replaceMachine}
                            onAisChanged={() => refreshAis()}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {revokedMachines.length > 0 && (
                  <section aria-label="Revoked machines" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={showRevoked}
                        title={showRevoked ? 'Hide revoked machines' : 'Show revoked machines'}
                        onClick={() => setShowRevoked((value) => !value)}
                        className="self-start px-1 text-[15px] font-semibold"
                      >
                        <ChevronDown
                          className={`size-4 transition-transform ${showRevoked ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                        Revoked ({revokedMachines.length})
                      </Button>
                      {pendingMachines.length === 0 && approvedMachines.length === 0 && (
                        <Button
                          type="button"
                          size="lg"
                          className="rounded-full px-5"
                          onClick={() => setAdding(true)}
                        >
                          <Plus aria-hidden="true" />
                          Add machine
                        </Button>
                      )}
                    </div>
                    {showRevoked && (
                      <ul className="flex flex-col gap-2">
                        {revokedMachines.map((machine) => (
                          <li key={machine.id}>
                            <RevokedRow
                              machine={machine}
                              confirmingDelete={confirming.delete === machine.id}
                              onConfirm={(id) => setConfirm('delete', id)}
                              onRemove={removeMachine}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>

      {adding && <AddMachineDialog onClose={() => setAdding(false)} />}
    </SettingsShell>
  );
}

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
function PendingRow({ machine, confirmingDeny, onConfirm, onUpdate, onRemove }: PendingRowProps) {
  const [approveState, approve] = useAction((id: string) =>
    fromApi(() => approveMachine(id)).pipe(
      Effect.tap((updated) => Effect.sync(() => onUpdate(id, updated))),
    ),
  );
  const [denyState, deny, denyControls] = useAction((id: string) =>
    fromApi(() => denyMachine(id)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          onRemove(id);
          onConfirm(null);
        }),
      ),
    ),
  );

  const denyFailure = shownFailure(denyState);
  const approveFailure = shownFailure(approveState);
  const actionError =
    denyFailure !== undefined
      ? failureText(denyFailure, 'Could not deny the machine.')
      : approveFailure !== undefined
        ? failureText(approveFailure, 'Could not approve the machine.')
        : '';

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

interface ApprovedRowProps {
  machine: Machine;
  confirmingRevoke: boolean;
  aiNames: string[] | null;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onAisChanged: () => void;
}

/**
 * One approved machine with its own rename and revoke actions. A revoke moves
 * the machine out of this section, so the AI list refresh runs on the page
 * (through `onAisChanged`), which stays mounted.
 */
function ApprovedRow({
  machine,
  confirmingRevoke,
  aiNames,
  onConfirm,
  onUpdate,
  onAisChanged,
}: ApprovedRowProps) {
  const [renameState, rename] = useAction((name: string) =>
    // Optimistic: the new name shows at once and goes back if the server refuses.
    Effect.sync(() => onUpdate(machine.id, { ...machine, name })).pipe(
      Effect.andThen(fromApi(() => renameMachine(machine.id, name))),
      Effect.tap((updated) => Effect.sync(() => onUpdate(machine.id, updated))),
      Effect.tapError(() => Effect.sync(() => onUpdate(machine.id, machine))),
    ),
  );
  const [revokeState, revoke, revokeControls] = useAction((id: string) =>
    fromApi(() => revokeMachine(id)).pipe(
      Effect.tap((updated) =>
        Effect.sync(() => {
          onAisChanged();
          onConfirm(null);
          onUpdate(id, updated);
        }),
      ),
    ),
  );

  const renameFailure = shownFailure(renameState);
  const revokeFailure = shownFailure(revokeState);
  const actionError =
    renameFailure !== undefined
      ? failureText(renameFailure, 'Could not rename the machine.')
      : revokeFailure !== undefined
        ? failureText(revokeFailure, 'Could not revoke the machine.')
        : '';

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

interface RevokedRowProps {
  machine: Machine;
  confirmingDelete: boolean;
  onConfirm: (id: string | null) => void;
  onRemove: (id: string) => void;
}

/** One revoked machine with its own delete action. */
function RevokedRow({ machine, confirmingDelete, onConfirm, onRemove }: RevokedRowProps) {
  const [deleteState, deleteMachineRow, deleteControls] = useAction((id: string) =>
    fromApi(() => deleteMachine(id)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          onRemove(id);
          onConfirm(null);
        }),
      ),
    ),
  );

  const deleteFailure = shownFailure(deleteState);
  const actionError =
    deleteFailure !== undefined ? failureText(deleteFailure, 'Could not delete the machine.') : '';

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

/** The last typed failure of a call, hidden while a new call runs. */
function shownFailure<A>(state: ActionState<A, ApiFailure>): ApiFailure | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

/** Clears the failure an earlier call left; a call that is still running is not interrupted. */
function clearFailure<A>(state: ActionState<A, ApiFailure>, controls: ActionControls): void {
  if (!isWaiting(state)) {
    controls.reset();
  }
}

/**
 * The text machineErrorMessage gives for an API answer. fromApi keeps an
 * ApiError's code, status and message; any other throw became the generic
 * unknown_error, which shows the fallback sentence instead.
 */
function failureText(failure: ApiFailure | undefined, fallback: string): string {
  if (failure === undefined || failure.code === 'unknown_error') {
    return fallback;
  }
  return machineErrorMessage(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}
