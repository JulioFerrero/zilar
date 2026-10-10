// The web transport of the derived contract client (T-0864). api.ts calls
// `callApi((client) => client.pins.list(...))`; the client is built once over
// the web runtime's `HttpClient`.
//
// The `fetch` adapter keeps what the hand-written `request()` sent, so the
// app's mock mode and the tests' `fetch` stubs see the same call: a relative
// `/api/...` path for a same-origin URL, a plain header record, a string
// body, and same-origin cookies. It reads `globalThis.fetch` per call, never
// once, so a later `vi.stubGlobal('fetch')` still reaches its stub.
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';
import {
  makeZilarClient,
  runApi,
  toApiError,
  withFetch,
  type ZilarClient,
} from '@zilar/api-contract';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest } from '@/mock/api';
import { webRuntime } from './runtime';

const webFetch: typeof globalThis.fetch = (input, init = {}) => {
  const url = new URL(String(input), window.location.href);
  const path = url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href;
  const plain: RequestInit = { ...init, headers: { ...(init.headers as Record<string, string>) } };
  if (isMockApiEnabled()) {
    // Standalone mock mode: answer locally, never touch the network (T-0069).
    return mockRequest(path, plain);
  }
  return globalThis.fetch(path, { credentials: 'same-origin', ...plain });
};

let client: ZilarClient | undefined;

function zilarClient(): ZilarClient {
  client ??= webRuntime.runSync(
    Effect.flatMap(Effect.service(HttpClient.HttpClient), (http) =>
      makeZilarClient(http.pipe(withFetch(webFetch))),
    ),
  );
  return client;
}

/** Runs one contract call; it rejects with the shared `ApiError` only. */
export function callApi<A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>): Promise<A> {
  return runApi(Effect.suspend(() => call(zilarClient())));
}

/**
 * `callApi` for a call a caller may cancel (message search). An abort
 * interrupts the request and rejects with the `DOMException` named
 * `AbortError`, as a `fetch` abort does; every other failure is an `ApiError`.
 */
export async function callApiAbortable<A, E>(
  call: (client: ZilarClient) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  // A function, not a direct read, so TypeScript does not narrow `aborted` to
  // `false` after the first check: the signal can still fire mid-request.
  const isAborted = () => signal?.aborted === true;
  const abortError = () => new DOMException('Aborted', 'AbortError');
  if (isAborted()) {
    throw abortError();
  }
  let value: A;
  try {
    value = await Effect.runPromise(
      Effect.mapError(
        Effect.suspend(() => call(zilarClient())),
        toApiError,
      ),
      signal === undefined ? undefined : { signal },
    );
  } catch (error) {
    throw isAborted() ? abortError() : error;
  }
  if (isAborted()) {
    throw abortError();
  }
  return value;
}
