// A derived-contract client for smoke tests that mount their own app (with a
// key cipher, a fake LiteLLM and the like), which `createSmokeHarness` cannot
// do. Same transport as the harness's `cookieClient`: the session cookie on
// every request, `fetch` injected so no socket opens.

import { Effect } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { makeZilarClient, withFetch, type ZilarClient } from '@zilar/api-contract';
import { TEST_BASE_URL } from '../test-support';

const baseHttpClient = Effect.runSync(
  Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
);

export interface RequestApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export function cookieClientFor(app: RequestApp, cookie: string): ZilarClient {
  const appFetch: typeof fetch = async (input, init) => app.request(String(input), init);
  return Effect.runSync(
    makeZilarClient(
      baseHttpClient.pipe(
        HttpClient.mapRequest(HttpClientRequest.setHeader('cookie', cookie)),
        withFetch(appFetch),
      ),
      { baseUrl: TEST_BASE_URL },
    ),
  );
}
