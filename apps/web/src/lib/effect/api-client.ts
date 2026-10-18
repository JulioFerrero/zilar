// The fetch adapter sends what the hand-written request() sent, so mock mode and the tests'
// fetch stubs see the same call; it reads globalThis.fetch per call, so a later
// vi.stubGlobal('fetch') still reaches its stub.
import { Effect } from 'effect';
import { HttpClient } from 'effect/http';
import {
  makeZilarClient,
  runApi,
  toApiError,
  withFetch,
  type ZilarClient,
} from '@zilar/api-contract';
import { runApiAbortable } from '@zilar/client-core';
import { isMockApiEnabled } from '@/mock/gate';
import { loadMockRequest } from '@/mock/load';
import { webRuntime } from './runtime';

const webFetch: typeof globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), window.location.href);
  const path = url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href;
  const plain: RequestInit = { ...init, headers: { ...(init.headers as Record<string, string>) } };
  if (isMockApiEnabled()) {
    // Standalone mock mode: answer locally; the loader keeps the mock backend out of prod builds.
    const dispatch = await loadMockRequest();
    return dispatch(path, plain);
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

/** Runs one contract call; it rejects with the shared ApiError only. */
export function callApi<A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>): Promise<A> {
  return runApi(Effect.suspend(() => call(zilarClient())));
}

/** callApi for a call a caller may cancel. An abort rejects with the DOMException named
 * AbortError, as a fetch abort does; every other failure is an ApiError. */
export function callApiAbortable<A, E>(
  call: (client: ZilarClient) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  return runApiAbortable(
    Effect.mapError(
      Effect.suspend(() => call(zilarClient())),
      toApiError,
    ),
    signal,
  );
}
