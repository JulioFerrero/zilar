import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronDown, Plus, Server } from 'lucide-react';
import {
  approveMachine,
  deleteMachine,
  denyMachine,
  listAis,
  listMachines,
  renameMachine,
  revokeMachine,
} from '@/lib/api';
import type { Machine, PublicAi } from '@/lib/api';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { AiPageShell } from '@/components/ais/AiPageShell';
import { AddMachineDialog } from '@/components/machines/AddMachineDialog';
import { ApprovedMachineCard } from '@/components/machines/ApprovedMachineCard';
import { MachineListSkeleton } from '@/components/machines/MachineListSkeleton';
import { PendingMachineCard } from '@/components/machines/PendingMachineCard';
import { RevokedMachineCard } from '@/components/machines/RevokedMachineCard';
import { machineErrorMessage } from '@/components/machines/errors';

type PageStatus = 'loading' | 'ready' | 'error';

interface PendingActionState {
  approve: string | null;
  deny: string | null;
  revoke: string | null;
  rename: string | null;
  delete: string | null;
}

const EMPTY_PENDING: PendingActionState = {
  approve: null,
  deny: null,
  revoke: null,
  rename: null,
  delete: null,
};

interface ConfirmingState {
  deny: string | null;
  revoke: string | null;
  delete: string | null;
}

const EMPTY_CONFIRMING: ConfirmingState = { deny: null, revoke: null, delete: null };

/** Settings → Machines. List, add, approve/deny, rename, revoke, delete. */
export function MachinesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PageStatus>('loading');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmingState>(EMPTY_CONFIRMING);
  const [pending, setPending] = useState<PendingActionState>(EMPTY_PENDING);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [showRevoked, setShowRevoked] = useState(false);
  // T-0091: the owner's AIs, used to label each approved machine card with
  // the AIs whose home machine it is. `null` means the load failed: the
  // card hides its "AIs: …" line and the rest of the page keeps working.
  const [ais, setAis] = useState<PublicAi[] | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listMachines();
      setMachines(list);
      setStatus('ready');
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(machineErrorMessage(error, 'Could not load your machines.'));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    let active = true;
    listMachines()
      .then((list) => {
        if (active) {
          setMachines(list);
          setStatus('ready');
          setErrorMessage('');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErrorMessage(machineErrorMessage(error, 'Could not load your machines.'));
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // T-0091: load the owner's AIs so the approved machine card can list
  // "AIs: A, B". The load is independent of the machines load: a failure
  // here just hides the line on each card, never blocks the page.
  useEffect(() => {
    let active = true;
    listAis()
      .then((list) => {
        if (active) {
          setAis(list);
        }
      })
      .catch(() => {
        if (active) {
          setAis(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const retry = (): void => {
    setStatus('loading');
    void load();
  };

  const setActionError = (key: string, message: string): void => {
    setActionErrors((previous) => ({ ...previous, [key]: message }));
  };

  const clearActionError = (key: string): void => {
    setActionErrors((previous) => {
      if (!(key in previous)) {
        return previous;
      }
      const { [key]: _removed, ...rest } = previous;
      void _removed;
      return rest;
    });
  };

  const approve = async (id: string): Promise<void> => {
    setPending((p) => ({ ...p, approve: id }));
    clearActionError(`approve:${id}`);
    try {
      const updated = await approveMachine(id);
      setMachines((previous) => previous.map((m) => (m.id === id ? updated : m)));
    } catch (error) {
      setActionError(`approve:${id}`, machineErrorMessage(error, 'Could not approve the machine.'));
    } finally {
      setPending((p) => ({ ...p, approve: null }));
    }
  };

  const askDeny = (id: string): void => {
    setConfirming((c) => ({ ...c, deny: id }));
    clearActionError(`deny:${id}`);
  };
  const cancelDeny = (id: string): void => {
    setConfirming((c) => ({ ...c, deny: null }));
    clearActionError(`deny:${id}`);
  };
  const confirmDeny = async (id: string): Promise<void> => {
    setPending((p) => ({ ...p, deny: id }));
    clearActionError(`deny:${id}`);
    try {
      await denyMachine(id);
      setMachines((previous) => previous.filter((m) => m.id !== id));
      setConfirming((c) => ({ ...c, deny: null }));
    } catch (error) {
      setActionError(`deny:${id}`, machineErrorMessage(error, 'Could not deny the machine.'));
    } finally {
      setPending((p) => ({ ...p, deny: null }));
    }
  };

  const askRevoke = (id: string): void => {
    setConfirming((c) => ({ ...c, revoke: id }));
    clearActionError(`revoke:${id}`);
  };
  const cancelRevoke = (id: string): void => {
    setConfirming((c) => ({ ...c, revoke: null }));
    clearActionError(`revoke:${id}`);
  };
  const confirmRevoke = async (id: string): Promise<void> => {
    setPending((p) => ({ ...p, revoke: id }));
    clearActionError(`revoke:${id}`);
    try {
      const updated = await revokeMachine(id);
      setMachines((previous) => previous.map((m) => (m.id === id ? updated : m)));
      setConfirming((c) => ({ ...c, revoke: null }));
      // T-0091: the server clears `ais.machineId` for the revoked machine
      // in the same transaction, so refresh the AI list to keep the card
      // labels in step. Best-effort: a failure here just leaves the
      // previous names until the next load.
      listAis()
        .then((list) => {
          setAis(list);
        })
        .catch(() => {
          // Keep the existing list; the card will refresh on the next
          // load or a future change.
        });
    } catch (error) {
      setActionError(`revoke:${id}`, machineErrorMessage(error, 'Could not revoke the machine.'));
    } finally {
      setPending((p) => ({ ...p, revoke: null }));
    }
  };

  const rename = async (id: string, name: string): Promise<void> => {
    setPending((p) => ({ ...p, rename: id }));
    clearActionError(`rename:${id}`);
    const previous = machines.find((m) => m.id === id);
    // Optimistic: update the local list so the inline edit feels instant.
    if (previous !== undefined) {
      setMachines((list) => list.map((m) => (m.id === id ? { ...m, name } : m)));
    }
    try {
      const updated = await renameMachine(id, name);
      setMachines((list) => list.map((m) => (m.id === id ? updated : m)));
    } catch (error) {
      if (previous !== undefined) {
        setMachines((list) => list.map((m) => (m.id === id ? previous : m)));
      }
      setActionError(`rename:${id}`, machineErrorMessage(error, 'Could not rename the machine.'));
    } finally {
      setPending((p) => ({ ...p, rename: null }));
    }
  };

  const askDelete = (id: string): void => {
    setConfirming((c) => ({ ...c, delete: id }));
    clearActionError(`delete:${id}`);
  };
  const cancelDelete = (id: string): void => {
    setConfirming((c) => ({ ...c, delete: null }));
    clearActionError(`delete:${id}`);
  };
  const confirmDelete = async (id: string): Promise<void> => {
    setPending((p) => ({ ...p, delete: id }));
    clearActionError(`delete:${id}`);
    try {
      await deleteMachine(id);
      setMachines((previous) => previous.filter((m) => m.id !== id));
      setConfirming((c) => ({ ...c, delete: null }));
    } catch (error) {
      setActionError(`delete:${id}`, machineErrorMessage(error, 'Could not delete the machine.'));
    } finally {
      setPending((p) => ({ ...p, delete: null }));
    }
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

  return (
    <AiPageShell
      title="Machines"
      subtitle="Computers where your AIs can work."
      onBack={() => navigate('/')}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {status === 'loading' && <MachineListSkeleton />}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FieldError>{errorMessage}</FieldError>
            <Button type="button" size="lg" className="rounded-full px-5" onClick={retry}>
              Retry
            </Button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="flex justify-end">
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

            {machines.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Server className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-[15px] text-muted-foreground">
                  No machines yet. Add one to let your AIs work on your own computers.
                </p>
                <Button
                  type="button"
                  size="lg"
                  className="rounded-full px-5"
                  onClick={() => setAdding(true)}
                >
                  Add machine
                </Button>
              </div>
            ) : (
              <>
                {pendingMachines.length > 0 && (
                  <section aria-label="Waiting for approval" className="flex flex-col gap-2">
                    <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                      Waiting for approval
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {pendingMachines.map((machine) => (
                        <li key={machine.id}>
                          <PendingMachineCard
                            machine={machine}
                            approving={pending.approve === machine.id}
                            denying={pending.deny === machine.id}
                            confirmingDeny={confirming.deny === machine.id}
                            actionError={
                              actionErrors[`deny:${machine.id}`] ??
                              actionErrors[`approve:${machine.id}`] ??
                              ''
                            }
                            onApprove={() => void approve(machine.id)}
                            onAskDeny={() => askDeny(machine.id)}
                            onCancelDeny={() => cancelDeny(machine.id)}
                            onConfirmDeny={() => void confirmDeny(machine.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {approvedMachines.length > 0 && (
                  <section aria-label="Your machines" className="flex flex-col gap-2">
                    <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                      Your machines
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {approvedMachines.map((machine) => (
                        <li key={machine.id}>
                          <ApprovedMachineCard
                            machine={machine}
                            renaming={pending.rename === machine.id}
                            revoking={pending.revoke === machine.id}
                            confirmingRevoke={confirming.revoke === machine.id}
                            actionError={
                              actionErrors[`rename:${machine.id}`] ??
                              actionErrors[`revoke:${machine.id}`] ??
                              ''
                            }
                            aiNames={ais === null ? null : (aisByMachineId.get(machine.id) ?? [])}
                            onRename={(name) => rename(machine.id, name)}
                            onAskRevoke={() => askRevoke(machine.id)}
                            onCancelRevoke={() => cancelRevoke(machine.id)}
                            onConfirmRevoke={() => void confirmRevoke(machine.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {revokedMachines.length > 0 && (
                  <section aria-label="Revoked machines" className="flex flex-col gap-2">
                    <button
                      type="button"
                      aria-expanded={showRevoked}
                      onClick={() => setShowRevoked((value) => !value)}
                      className="flex items-center gap-1 self-start text-[13px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown
                        className={`size-4 transition-transform ${showRevoked ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                      Revoked ({revokedMachines.length})
                    </button>
                    {showRevoked && (
                      <ul className="flex flex-col gap-2">
                        {revokedMachines.map((machine) => (
                          <li key={machine.id}>
                            <RevokedMachineCard
                              machine={machine}
                              deleting={pending.delete === machine.id}
                              confirmingDelete={confirming.delete === machine.id}
                              actionError={actionErrors[`delete:${machine.id}`] ?? ''}
                              onAskDelete={() => askDelete(machine.id)}
                              onCancelDelete={() => cancelDelete(machine.id)}
                              onConfirmDelete={() => void confirmDelete(machine.id)}
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
    </AiPageShell>
  );
}
