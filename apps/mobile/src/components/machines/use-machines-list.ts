import { useFocusEffect } from 'expo-router';
import { Effect } from 'effect';
import { useCallback, useRef, useState } from 'react';

import { useAction } from '@/lib/effect/use-action';
import type { Machine, PairingCode } from '@/lib/machines-api';
import type { MachinesErrorInfo } from './errors';
import { applyChange, call, mutationCall, type MachineMutation } from './mutations';
import { useMachinesApi } from './use-machines-api';

type PageStatus = 'loading' | 'ready' | 'error';

/** The state, handlers and sections the machines screen renders. */
export function useMachinesList() {
  const { api } = useMachinesApi();

  const [machines, setMachines] = useState<Machine[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<MachinesErrorInfo>({ message: '' });
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ kind: 'revoke' | 'delete'; id: string } | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState('');
  // The add flow state lives here: the "Add machine" tap mints
  // the code directly (an event, not an effect), and the sheet only renders
  // the result. `addToken` guards a late answer after the sheet closed.
  // `mintCode` ignores a second tap while a code is being made (10 per hour).
  const [adding, setAdding] = useState(false);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const addToken = useRef(0);
  const [showRevoked, setShowRevoked] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const setRowError = (id: string, message: string): void => {
    setActionErrors((previous) => ({ ...previous, [id]: message }));
  };

  const clearRowError = (id: string): void => {
    setActionErrors((previous) => {
      if (!(id in previous)) {
        return previous;
      }
      const { [id]: _removed, ...rest } = previous;
      void _removed;
      return rest;
    });
  };

  // Loads the list. A reload (focus, Retry) replaces one still running.
  const [, loadList] = useAction(
    (_input: void) =>
      Effect.sync(() => {
        setStatus('loading');
        setActionErrors({});
      }).pipe(
        Effect.andThen(call(() => api.listMachines(), 'Could not load your machines.')),
        Effect.tap((list) =>
          Effect.sync(() => {
            setMachines(list);
            setStatus('ready');
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            setErrorInfo({ message: failure.message });
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  const reload = useCallback(() => {
    loadList();
  }, [loadList]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // One mutation at a time: a second tap while one runs is dropped.
  const [, runMutation] = useAction((input: MachineMutation) => {
    const dialog = input.kind === 'revoke' || input.kind === 'delete';
    return Effect.sync(() => {
      setBusyId(input.id);
      if (dialog) {
        setConfirmError('');
      } else {
        clearRowError(input.id);
      }
    }).pipe(
      Effect.andThen(mutationCall(api, input)),
      Effect.tap((change) =>
        Effect.sync(() => {
          setMachines((previous) => applyChange(previous, change));
          if (input.kind === 'rename') {
            setRenamingId(null);
          }
          if (dialog) {
            setConfirming(null);
          }
        }),
      ),
      Effect.catch((failure) =>
        Effect.sync(() => {
          if (dialog) {
            setConfirmError(failure.message);
          } else {
            setRowError(input.id, failure.message);
          }
        }),
      ),
      Effect.ensuring(Effect.sync(() => setBusyId(null))),
    );
  });

  const [, mintCode] = useAction(
    (_input: void) =>
      Effect.sync(() => {
        addToken.current += 1;
        setAdding(true);
        setPairingLoading(true);
        setPairingError('');
        setPairing(null);
        return addToken.current;
      }).pipe(
        Effect.flatMap((token) =>
          call(() => api.createPairingCode(), 'Could not create a pairing code.').pipe(
            Effect.tap((next) =>
              Effect.sync(() => {
                if (addToken.current === token) {
                  setPairing(next);
                }
              }),
            ),
            Effect.catch((failure) =>
              Effect.sync(() => {
                if (addToken.current === token) {
                  setPairingError(failure.message);
                }
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (addToken.current === token) {
                  setPairingLoading(false);
                }
              }),
            ),
          ),
        ),
      ),
    { mode: 'ignore' },
  );

  const openAdd = useCallback(() => {
    mintCode();
  }, [mintCode]);

  const closeAdd = useCallback(() => {
    addToken.current += 1;
    setAdding(false);
  }, []);

  const retryAdd = useCallback(() => {
    closeAdd();
    openAdd();
  }, [closeAdd, openAdd]);

  const approve = (id: string): void => {
    runMutation({ kind: 'approve', id });
  };

  const deny = (id: string): void => {
    runMutation({ kind: 'deny', id });
  };

  const openRename = (machine: Machine): void => {
    setRenamingId(machine.id);
    setRenameDraft(machine.name);
    clearRowError(machine.id);
  };

  const saveRename = (id: string): void => {
    const name = renameDraft.trim();
    if (name === '') {
      setRowError(id, 'Give the machine a name.');
      return;
    }
    runMutation({ kind: 'rename', id, name });
  };

  const askConfirm = (kind: 'revoke' | 'delete', id: string): void => {
    setConfirming({ kind, id });
    setConfirmError('');
  };

  const askRevoke = (id: string): void => {
    askConfirm('revoke', id);
  };

  const askDelete = (id: string): void => {
    askConfirm('delete', id);
  };

  const confirmAction = (): void => {
    if (confirming === null) {
      return;
    }
    runMutation({ kind: confirming.kind, id: confirming.id });
  };

  const cancelConfirm = (): void => {
    setConfirming(null);
  };

  const cancelRename = (): void => {
    setRenamingId(null);
  };

  const toggleRevoked = (): void => {
    setShowRevoked((value) => !value);
  };

  const pending = machines.filter((m) => m.status === 'pending');
  const approved = machines.filter((m) => m.status === 'approved');
  const revoked = machines.filter((m) => m.status === 'revoked');

  return {
    machines,
    status,
    errorInfo,
    actionErrors,
    busyId,
    confirming,
    confirmError,
    adding,
    pairing,
    pairingLoading,
    pairingError,
    showRevoked,
    renamingId,
    renameDraft,
    pending,
    approved,
    revoked,
    setRenameDraft,
    reload,
    approve,
    deny,
    openRename,
    saveRename,
    askRevoke,
    askDelete,
    confirmAction,
    cancelConfirm,
    cancelRename,
    toggleRevoked,
    openAdd,
    closeAdd,
    retryAdd,
  };
}
