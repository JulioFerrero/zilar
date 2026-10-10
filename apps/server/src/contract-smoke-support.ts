// Shared setup of the contract smoke tests (T-0864, T-0891): clients derived
// from `@zilar/api-contract` run against the real app with `fetch` injected,
// so no socket opens. Each module's `contract.smoke.test.ts` builds a harness
// with `createSmokeHarness` in its `beforeEach` and closes it in `afterEach`.

import { Effect } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { makeZilarClient, withFetch, type ZilarClient } from '@zilar/api-contract';
import {
  createTestContext,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from './test-support';

const baseHttpClient = Effect.runSync(
  Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
);

export interface SmokeHarness {
  readonly context: TestContext;
  readonly app: TestApp;
  /** The number of requests the clients have sent to the app so far. */
  readonly requestCount: () => number;
  /** The web transport: the session cookie on every request. */
  readonly cookieClient: (cookie: string) => ZilarClient;
  /** The mobile transport: the bearer token on every request. */
  readonly bearerClient: (token: string) => ZilarClient;
}

export async function createSmokeHarness(): Promise<SmokeHarness> {
  const context = await createTestContext();
  const app = testApp(context);
  let requests = 0;

  const appFetch: typeof fetch = (input, init) => {
    requests += 1;
    return app.request(String(input), init);
  };

  return {
    context,
    app,
    requestCount: () => requests,
    cookieClient: (cookie) =>
      Effect.runSync(
        makeZilarClient(
          baseHttpClient.pipe(
            HttpClient.mapRequest(HttpClientRequest.setHeader('cookie', cookie)),
            withFetch(appFetch),
          ),
          { baseUrl: TEST_BASE_URL },
        ),
      ),
    bearerClient: (token) =>
      Effect.runSync(
        makeZilarClient(
          baseHttpClient.pipe(
            HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
            withFetch(appFetch),
          ),
          { baseUrl: TEST_BASE_URL },
        ),
      ),
  };
}
