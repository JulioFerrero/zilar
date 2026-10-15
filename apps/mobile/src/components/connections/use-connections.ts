import { useFocusEffect } from 'expo-router';
import { Effect } from 'effect';
import { useCallback, useRef, useState } from 'react';

import {
  describeConnectionsError,
  type ConnectionsErrorInfo,
} from '@/components/connections/errors';
import { useConnectionsApi } from '@/components/connections/use-connections-api';
import type { ProviderConnection } from '@/lib/connections-api';
import { useAction } from '@/lib/effect/use-action';

type PageStatus = 'loading' | 'ready' | 'error';

/** Removes one key from a record without mutating it. */
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const { [key]: _removed, ...rest } = record;
  void _removed;
  return rest;
}

/**
 * The connections screen's state and handlers: the loaded list, the page
 * status and the Test, Replace and Remove flows.
 *
 * The state stays in React `useState` as before; each network call is an
 * Effect run by `useAction`, which writes the results back into that state.
 * `useAction` also gives the single-flight guard (a second tap while one call
 * runs is ignored) and interrupts a running call on unmount.
 */
export function useConnections({
  onTestFailed,
  onReplaced,
}: {
  /** Fires after a test finishes with a failure, so the caller can close its sheet. */
  onTestFailed?: () => void;
  /** Fires after a key is replaced, so the caller can toast and close its sheet. */
  onReplaced?: () => void;
} = {}) {
  const { api } = useConnectionsApi();

  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorInfo, setErrorInfo] = useState<ConnectionsErrorInfo>({ message: '' });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped whenever a replace starts. A test that began earlier captured the
  // old value, so its late result belongs to the replaced key and is dropped.
  const replaceGeneration = useRef(0);

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
  const [, runTest] = useAction((id: string) => {
    // The key this test runs against; a replace started after it bumps the
    // counter, so the late result is dropped instead of trusted for the new key.
    const generation = replaceGeneration.current;
    return Effect.sync(() => {
      setTestingId(id);
      setTestErrors((previous) => withoutKey(previous, id));
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.testConnection(id),
          catch: (cause) => cause,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (replaceGeneration.current !== generation) {
                return;
              }
              setTestResults((previous) => ({ ...previous, [id]: result.ok }));
              if (!result.ok) {
                setTestErrors((previous) => ({ ...previous, [id]: 'The key was rejected.' }));
                onTestFailed?.();
              }
            }),
          ),
          Effect.catch(() =>
            Effect.sync(() => {
              if (replaceGeneration.current !== generation) {
                return;
              }
              setTestResults((previous) => ({ ...previous, [id]: false }));
              setTestErrors((previous) => ({ ...previous, [id]: 'Could not test the key.' }));
              onTestFailed?.();
            }),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setTestingId(null))),
    );
  });

  // The new key is untested, so its row forgets this screen's last result.
  const [, runReplaceKey] = useAction((input: { id: string; key: string }) =>
    Effect.sync(() => {
      setReplacing(true);
      setReplaceError('');
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.replaceConnectionKey(input.id, input.key),
          catch: (cause): ConnectionsErrorInfo =>
            describeConnectionsError(cause, 'Could not replace the key.'),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setTestResults((previous) => withoutKey(previous, input.id));
              setTestErrors((previous) => withoutKey(previous, input.id));
              onReplaced?.();
            }),
          ),
          Effect.catch((info) => Effect.sync(() => setReplaceError(info.message))),
        ),
      ),
      Effect.ensuring(Effect.sync(() => setReplacing(false))),
    ),
  );

  const clearReplaceError = useCallback(() => setReplaceError(''), []);

  const replaceKey = useCallback(
    (id: string, key: string) => {
      // Any test already in flight now describes the old key, so its result is
      // dropped when it lands (see `runTest`).
      replaceGeneration.current += 1;
      runReplaceKey({ id, key });
    },
    [runReplaceKey],
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
    testingId,
    testResults,
    testErrors,
    replacing,
    replaceError,
    confirmingId,
    removeError,
    busy,
    reload,
    runTest,
    replaceKey,
    clearReplaceError,
    removeConnection,
    askRemove,
    cancelRemove,
  };
}
