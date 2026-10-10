import { useFocusEffect } from 'expo-router';
import { Effect } from 'effect';
import { useCallback, useState } from 'react';

import {
  describeConnectionsError,
  type ConnectionsErrorInfo,
} from '@/components/connections/errors';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import type { ProviderConnection } from '@/lib/connections-api';
import { useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

/**
 * The connections screen's state and handlers: the loaded list, the page
 * status, the Test and Remove flows and the add-form visibility.
 *
 * The state stays in React `useState` as before; each network call is an
 * Effect run by `useAction`, which writes the results back into that state.
 * `useAction` also gives the single-flight guard (a second tap while one call
 * runs is ignored) and interrupts a running call on unmount.
 */
export function useConnections() {
  const { api } = useConnectionsApi();

  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<ConnectionsErrorInfo>({ message: '' });
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);

  // Latest reload wins: a focus reload replaces a load still in flight.
  const [, load] = useAction(
    () =>
      Effect.tryPromise({
        try: () => api.listConnections(),
        catch: (cause): ConnectionsErrorInfo =>
          describeConnectionsError(cause, 'Could not load your connections.'),
      }).pipe(
        Effect.tap((list) =>
          Effect.sync(() => {
            setConnections(list);
            setStatus('ready');
          }),
        ),
        Effect.catch((info) =>
          Effect.sync(() => {
            setErrorInfo(info);
            setStatus('error');
          }),
        ),
      ),
    { mode: 'replace' },
  );

  const reload = useCallback(() => {
    setStatus('loading');
    load(undefined);
  }, [load]);

  // A second tap on any Test is ignored while one test runs (one lock for
  // all rows, as the server rate-limits key tests per user).
  const [, runTest] = useAction((id: string) =>
    Effect.sync(() => {
      setTestingId(id);
      setTestErrors((previous) => {
        if (!(id in previous)) return previous;
        const { [id]: _removed, ...rest } = previous;
        void _removed;
        return rest;
      });
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.testConnection(id),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              setTestResults((previous) => ({ ...previous, [id]: result.ok }));
              if (!result.ok) {
                setTestErrors((previous) => ({ ...previous, [id]: 'The key was rejected.' }));
              }
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              setTestResults((previous) => ({ ...previous, [id]: false }));
              setTestErrors((previous) => ({ ...previous, [id]: 'Could not test the key.' }));
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setTestingId(null))),
    ),
  );

  // A second tap on any Remove is ignored while one removal runs.
  const [, removeConnection] = useAction((id: string) =>
    Effect.sync(() => {
      setBusy(true);
      setRemoveError('');
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.deleteConnection(id),
          catch: (cause): ConnectionsErrorInfo =>
            describeConnectionsError(cause, 'Could not remove the connection.'),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setConnections((previous) => previous.filter((connection) => connection.id !== id));
              setConfirmingId(null);
            }),
          ),
          Effect.catch((info) => Effect.sync(() => setRemoveError(info.message))),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    ),
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const askRemove = (id: string): void => {
    setConfirmingId(id);
    setRemoveError('');
  };

  const cancelRemove = (): void => {
    setConfirmingId(null);
    setRemoveError('');
  };

  return {
    connections,
    status,
    errorInfo,
    showForm,
    testingId,
    testResults,
    testErrors,
    confirmingId,
    removeError,
    busy,
    setConnections,
    setShowForm,
    reload,
    runTest,
    removeConnection,
    askRemove,
    cancelRemove,
  };
}
