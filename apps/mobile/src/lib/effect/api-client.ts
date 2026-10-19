// The mobile transport of the derived contract client: a missing token fails `unauthorized` before anything is sent, and the `fetch` adapter sends a string URL, a plain header record and a string body.
import { Effect } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import {
  ApiError,
  makeZilarClient,
  runApi,
  withFetch,
  type ZilarClient,
} from '@zilar/api-contract';
import { API_TIMEOUT_MS, fetchWithTimeout } from './fetch-timeout';
import { mobileRuntime } from './runtime';

export interface ApiTransport {
  readonly getToken: () => Promise<string | undefined>;
  readonly fetchImpl: typeof fetch;
  readonly apiUrl: string;
}

export function createApiClient({ getToken, fetchImpl, apiUrl }: ApiTransport): ZilarClient {
  const adapter: typeof fetch = (input, init = {}) =>
    fetchWithTimeout(
      fetchImpl,
      String(input),
      {
        ...init,
        credentials: 'omit',
        headers: { ...(init.headers as Record<string, string>) },
      },
      API_TIMEOUT_MS,
    );
  const withBearer = HttpClient.mapRequestEffect((request: HttpClientRequest.HttpClientRequest) =>
    Effect.flatMap(Effect.promise(getToken), (token) =>
      token === undefined
        ? Effect.fail(new ApiError(401, 'unauthorized', 'No session'))
        : Effect.succeed(HttpClientRequest.bearerToken(request, token)),
    ),
  );
  return mobileRuntime.runSync(
    Effect.flatMap(Effect.service(HttpClient.HttpClient), (http) =>
      makeZilarClient(http.pipe(withBearer, withFetch(adapter)), { baseUrl: apiUrl }),
    ),
  );
}

export type ApiCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

export function apiCall(transport: ApiTransport): ApiCall {
  const client = createApiClient(transport);
  return (call) => runApi(call(client));
}
