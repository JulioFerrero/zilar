import { useMemo, useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useNavigate } from 'react-router';
import { ChevronDown, Server } from 'lucide-react';
import { listAis, listMachines } from '@/lib/api';
import type { Machine, PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { Button } from '@/components/ais/AiPageShell';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { StateMessage } from '@/components/ui/state-message';
import { AddMachineDialog } from '@/components/machines/AddMachineDialog';
import { AddMachineButton } from '@/components/machines/AddMachineButton';
import { ApprovedRow } from '@/components/machines/ApprovedRow';
import { MachineListSkeleton } from '@/components/machines/MachineListSkeleton';
import { PendingRow } from '@/components/machines/PendingRow';
import { RevokedRow } from '@/components/machines/RevokedRow';
import type { ConfirmingState, ConfirmKind } from '@/components/machines/machineRowOps';
import { EMPTY_CONFIRMING, failureText } from '@/components/machines/machineRowOps';

type PageStatus = 'loading' | 'ready' | 'error';

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
                      <AddMachineButton onClick={() => setAdding(true)} />
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
                        <AddMachineButton onClick={() => setAdding(true)} />
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
                        <AddMachineButton onClick={() => setAdding(true)} />
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
