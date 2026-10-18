import { isClientOutdated } from '@zilar/protocol';
import { Effect, Schedule } from 'effect';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type OnForeground = (cb: () => void) => () => void;

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const REFRESH_MS = 60 * 1000;

export function readMinClientProtocol(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as { minClientProtocol?: unknown }).minClientProtocol;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

const fetchMinClientProtocol = (
  fetchHealth: () => Promise<Response>,
): Promise<string | undefined> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({ try: fetchHealth, catch: () => undefined });
      if (!response.ok) {
        return undefined;
      }
      const body = yield* Effect.tryPromise({ try: () => response.json(), catch: () => undefined });
      return readMinClientProtocol(body);
    }).pipe(Effect.orElseSucceed(() => undefined)),
  );

/**
 * True when this build is older than the server's minimum protocol; checked at boot
 * and on every foreground.
 */
export function useClientVersionCheck(
  fetchHealth: () => Promise<Response>,
  onForeground: OnForeground,
  currentProtocol: string,
): boolean {
  const [outdated, setOutdated] = useState(false);
  const lastCheckedAt = useRef(0);

  const check = useCallback(() => {
    const now = Date.now();
    if (now - lastCheckedAt.current < CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckedAt.current = now;
    void fetchMinClientProtocol(fetchHealth).then((minimum) => {
      if (minimum !== undefined) {
        setOutdated(isClientOutdated(currentProtocol, minimum));
      }
    });
  }, [fetchHealth, currentProtocol]);

  useEffect(() => {
    check();
    return onForeground(check);
  }, [check, onForeground]);

  return outdated;
}

/** One fetch and store; a failed call leaves the previous list in place. */
const refreshEffect = <T>(
  list: () => Promise<T[]>,
  setRequests: (rows: T[]) => void,
): Effect.Effect<void> =>
  Effect.tryPromise({ try: list, catch: (cause) => cause }).pipe(
    Effect.matchEffect({
      onSuccess: (rows) => Effect.sync(() => setRequests(rows)),
      onFailure: () => Effect.void,
    }),
  );

/**
 * Loads a list once, every 60 seconds and on every foreground. A failed call keeps
 * the previous list; `reload` refreshes at once.
 */
export function useContactRequestsPoll<T>(
  list: () => Promise<T[]>,
  enabled: boolean,
  onForeground: OnForeground,
): { requests: T[]; reload: () => void } {
  const [requests, setRequests] = useState<T[]>([]);
  const latestList = useRef(list);
  useLayoutEffect(() => {
    latestList.current = list;
  });

  const reload = useCallback(() => {
    void Effect.runPromise(refreshEffect(() => latestList.current(), setRequests));
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    const loop = Effect.repeat(
      refreshEffect(() => latestList.current(), setRequests),
      Schedule.fixed(REFRESH_MS),
    );
    void Effect.runPromise(loop, { signal: controller.signal }).catch(() => undefined);
    const unsubscribe = onForeground(reload);
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [enabled, reload, onForeground]);

  return { requests, reload };
}
