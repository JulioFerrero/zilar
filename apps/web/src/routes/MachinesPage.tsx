import { useMemo, useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useNavigate } from 'react-router';
import { Ban, ChevronRight, Server } from 'lucide-react';
import { listAis, listMachines } from '@/lib/api';
import type { Machine, PublicAi } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { cn } from '@/lib/utils';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { StateMessage } from '@/components/ui/state-message';
import { AddMachineDialog } from '@/components/machines/AddMachineDialog';
import { AddMachineButton } from '@/components/machines/AddMachineButton';
import { MachineListRow } from '@/components/machines/MachineListRow';
import { MachineListSkeleton } from '@/components/machines/MachineListSkeleton';
import { PendingRow } from '@/components/machines/PendingRow';
import { RevokedRow } from '@/components/machines/RevokedRow';
import type { ConfirmingState, ConfirmKind } from '@/components/machines/machineRowOps';
import { EMPTY_CONFIRMING, failureText } from '@/components/machines/machineRowOps';

type PageStatus = 'loading' | 'ready' | 'error';

export function MachinesPage() {
  const navigate = useNavigate();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmingState>(EMPTY_CONFIRMING);
  const [showRevoked, setShowRevoked] = useState(false);
  // The owner's AIs label each approved machine row with its home AI. null means the load
  // failed: the row hides its avatar and the card its AIs line, and the page keeps working.
  const [ais, setAis] = useState<PublicAi[] | null>(null);

  const [loadState, reload] = useQuery(
    () =>
      fromApi(() => listMachines()).pipe(
        Effect.tap((list) => Effect.sync(() => setMachines(list))),
      ),
    [],
  );

  // The AI load is independent of the machines load: a failure drops those bits and never
  // blocks the page; a failed refresh keeps the list it had.
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

  // Keep the local AI list in step when the server returns a fresh AI (e.g. on revoke), so
  // the row drops the picture at once; null skips the lookup entirely.
  const aisByMachineId = useMemo(() => {
    const map = new Map<string, PublicAi[]>();
    if (ais === null) {
      return map;
    }
    for (const ai of ais) {
      if (ai.machineId !== null && ai.machineId !== undefined) {
        const list = map.get(ai.machineId) ?? [];
        list.push(ai);
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
      action={<AddMachineButton onClick={() => setAdding(true)} />}
      onBack={() => navigate('/settings')}
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

        {status === 'ready' &&
          (machines.length === 0 ? (
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
                <ul aria-label="Waiting for approval" className="flex flex-col gap-2">
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
              )}

              {(approvedMachines.length > 0 || revokedMachines.length > 0) && (
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {approvedMachines.map((machine) => {
                    const machineAis = aisByMachineId.get(machine.id) ?? [];
                    return (
                      <MachineListRow
                        key={machine.id}
                        machine={machine}
                        ai={machineAis[0]}
                        aiNames={ais === null ? null : machineAis.map((entry) => entry.name)}
                        confirmingRevoke={confirming.revoke === machine.id}
                        onConfirm={(id) => setConfirm('revoke', id)}
                        onUpdate={replaceMachine}
                        onAisChanged={() => refreshAis()}
                      />
                    );
                  })}

                  {revokedMachines.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={showRevoked}
                      onClick={() => setShowRevoked((value) => !value)}
                      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-muted-foreground transition-colors hover:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 focus-visible:outline-none"
                    >
                      <Ban className="size-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 text-[15px]">Revoked</span>
                      <span className="font-mono text-[12px]">{revokedMachines.length}</span>
                      <ChevronRight
                        className={cn(
                          'size-4 shrink-0 transition-transform',
                          showRevoked && 'rotate-90',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              )}

              {showRevoked && revokedMachines.length > 0 && (
                <ul aria-label="Revoked machines" className="flex flex-col gap-2">
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
            </>
          ))}
      </div>

      {adding && <AddMachineDialog onClose={() => setAdding(false)} />}
    </SettingsShell>
  );
}
