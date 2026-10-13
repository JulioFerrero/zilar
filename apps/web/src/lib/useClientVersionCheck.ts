import { isClientOutdated, protocolVersion } from '@zilar/protocol';
import { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runWeb } from '@/lib/effect/runtime';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';

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

// One `/health` request. In mock mode it goes through the mock backend, which
// answers 404, so a mock session never shows the banner.
const healthRequest = (): Promise<Response> =>
  isMockApiEnabled()
    ? loadMockRequest().then((dispatch) => dispatch('/health', { method: 'GET' }))
    : fetch('/health', { method: 'GET', credentials: 'same-origin' });

/**
 * The server's minimum client protocol, or undefined when `/health` cannot be
 * read. A failed call is swallowed: the caller keeps its previous answer.
 */
const fetchMinClientProtocol = (): Promise<string | undefined> =>
  runWeb(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({ try: healthRequest, catch: () => undefined });
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
 * checks once at boot and again on every window focus or tab re-show, but at
 * most once per ten minutes, so an open tab notices a breaking deploy without
 * hammering `/health`. A failed check changes nothing and never blocks use.
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
    const onFocus = (): void => check();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        check();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [check]);

  return outdated;
}
