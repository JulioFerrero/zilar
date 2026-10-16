import { isClientOutdated, protocolVersion } from '@zilar/protocol';
import { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { runMobile } from '@/lib/effect/runtime';
import { API_URL } from './auth';

/** Check `/health` at most once every ten minutes. */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Reads `minClientProtocol` from a `/health` body; any other shape is undefined. */
function readMinClientProtocol(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const value = (raw as { minClientProtocol?: unknown }).minClientProtocol;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The server's minimum client protocol, or undefined when `/health` cannot be
 * read. A failed call is swallowed: the caller keeps its previous answer.
 */
const fetchMinClientProtocol = (): Promise<string | undefined> =>
  runMobile(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${API_URL}/health`, { method: 'GET', credentials: 'omit' }),
        catch: () => undefined,
      });
      if (!response.ok) {
        return undefined;
      }
      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => undefined,
      });
      return readMinClientProtocol(body);
    }).pipe(Effect.orElseSucceed(() => undefined)),
  );

/**
 * True when this build is older than the server's minimum client protocol. It
 * checks once at boot and again every time the app returns to the foreground,
 * but at most once per ten minutes. A failed check changes nothing and never
 * blocks use.
 */
export function useClientVersionCheck(): boolean {
  const [outdated, setOutdated] = useState(false);
  const lastCheckedAt = useRef(0);

  const check = useCallback(() => {
    const now = Date.now();
    if (now - lastCheckedAt.current < CHECK_INTERVAL_MS) {
      return;
    }
    lastCheckedAt.current = now;
    void fetchMinClientProtocol().then((minimum) => {
      if (minimum !== undefined) {
        setOutdated(isClientOutdated(protocolVersion, minimum));
      }
    });
  }, []);

  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check();
      }
    });
    return () => subscription.remove();
  }, [check]);

  return outdated;
}
