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
  readonly requestCount: () => number;
  readonly cookieClient: (cookie: string) => ZilarClient;
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
