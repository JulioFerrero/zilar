// The mobile transport of the derived contract client (T-0864): the injected
// `fetch`, the build-time API URL, and the bearer token on every request. A
// missing token fails `unauthorized` before anything is sent, as the
// hand-written clients did.
//
// The `fetch` adapter keeps what those clients sent: a string URL, a plain
// header record and a string body, so injected `fetchImpl` fakes keep working.
import { Effect } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { ApiError, makeZilarClient, withFetch, type ZilarClient } from '@zilar/api-contract';
import { mobileRuntime } from './runtime';

export interface ApiTransport {
  readonly getToken: () => Promise<string | undefined>;
  readonly fetchImpl: typeof fetch;
  readonly apiUrl: string;
}

export function createApiClient({ getToken, fetchImpl, apiUrl }: ApiTransport): ZilarClient {
  const adapter: typeof fetch = (input, init = {}) =>
    fetchImpl(String(input), {
      ...init,
      headers: { ...(init.headers as Record<string, string>) },
    });
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
