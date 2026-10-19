// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
import type { AuthSession, AuthSessions, ZilarClient } from '@zilar/api-contract';
import type { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';

type DevicesCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

export const DEVICES_LOAD_ERROR = 'Could not load your devices. Try again.';
export const DEVICES_SIGN_OUT_ERROR = 'Could not sign out. Try again.';

/** The sessions list and the per-session revoke; the rows carry no token and no IP address. */
export function makeDevicesApi(call: DevicesCall) {
  return {
    listSessions: (): Promise<AuthSessions> => call((client) => client.auth.listSessions()),
    revokeSession: (id: string): Promise<void> =>
      call((client) => client.auth.revokeSession({ params: { id } })).then(() => undefined),
  };
}

export type DevicesApi = ReturnType<typeof makeDevicesApi>;
export type DevicesStatus = 'loading' | 'ready' | 'error';

export interface DevicesState {
  readonly status: DevicesStatus;
  readonly sessions: readonly AuthSession[];
  readonly current: AuthSession | undefined;
  readonly others: readonly AuthSession[];
  readonly error: string;
  readonly setError: (message: string) => void;
  readonly refresh: () => Promise<void>;
  readonly signOut: (id: string) => Promise<void>;
  readonly signOutAll: () => Promise<void>;
  readonly busyIds: ReadonlySet<string>;
  readonly bulkBusy: boolean;
}

/**
 * Every signed-in session, this one first. A refresh with rows on screen keeps them when it
 * fails; a first load shows the load sentence instead. Sign-outs run side by side.
 */
export function useDevices(api: DevicesApi): DevicesState {
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [status, setStatus] = useState<DevicesStatus>('loading');
  const [error, setError] = useState('');
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const latest = useRef({ sessions, status });
  useEffect(() => {
    latest.current = { sessions, status };
  });

  // A focus effect beside the mount load joins the same request instead of loading twice.
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current !== null) {
      return inFlight.current;
    }
    const keepContent = latest.current.status === 'ready';
    if (!keepContent) {
      setStatus('loading');
    }
    setError('');
    const run = api
      .listSessions()
      .then((body) => {
        setSessions([...body.sessions]);
        setStatus('ready');
      })
      .catch(() => {
        if (!keepContent) {
          setError(DEVICES_LOAD_ERROR);
          setStatus('error');
        }
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    return run;
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(
    async (id: string): Promise<void> => {
      setError('');
      setBusyIds((ids) => new Set(ids).add(id));
      try {
        await api.revokeSession(id);
        setSessions((rows) => rows.filter((row) => row.id !== id));
      } catch {
        setError(DEVICES_SIGN_OUT_ERROR);
      } finally {
        setBusyIds((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
      }
    },
    [api],
  );

  const signOutAll = useCallback(async (): Promise<void> => {
    const ids = latest.current.sessions.filter((session) => !session.current).map((s) => s.id);
    setError('');
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.revokeSession(id)));
      if (results.some((result) => result.status === 'rejected')) {
        setError(DEVICES_SIGN_OUT_ERROR);
      }
      const body = await api.listSessions();
      setSessions([...body.sessions]);
      setStatus('ready');
    } catch {
      setError(DEVICES_SIGN_OUT_ERROR);
    } finally {
      setBulkBusy(false);
    }
  }, [api]);

  return {
    status,
    sessions,
    current: sessions.find((session) => session.current),
    others: sessions.filter((session) => !session.current),
    error,
    setError,
    refresh,
    signOut,
    signOutAll,
    busyIds,
    bulkBusy,
  };
}
