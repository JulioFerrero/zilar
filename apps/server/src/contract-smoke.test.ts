// The contract drift detector (T-0864): the client derived from
// `@zilar/api-contract` runs against the real app, with `fetch` injected so
// no socket opens. A route whose status or body drifts from the contract
// fails here with `invalid_response`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import {
  ApiError,
  makeZilarClient,
  runApi,
  withFetch,
  type ZilarClient,
} from '@zilar/api-contract';
import {
  bootstrapUser,
  contactOf,
  createTestContext,
  expectedJid,
  testApp,
  TEST_BASE_URL,
  type TestApp,
  type TestContext,
} from './test-support';

const baseHttpClient = Effect.runSync(
  Effect.provide(Effect.service(HttpClient.HttpClient), FetchHttpClient.layer),
);

describe('api contract smoke (T-0864)', () => {
  let context: TestContext;
  let app: TestApp;
  let requests: number;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
    requests = 0;
  });

  afterEach(async () => {
    await context.close();
  });

  const appFetch: typeof fetch = (input, init) => {
    requests += 1;
    return app.request(String(input), init);
  };

  // The web transport: the session cookie on every request.
  function cookieClient(cookie: string): ZilarClient {
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

  // The mobile transport: the bearer token on every request.
  function bearerClient(token: string): ZilarClient {
    return Effect.runSync(
      makeZilarClient(
        baseHttpClient.pipe(
          HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
          withFetch(appFetch),
        ),
        { baseUrl: TEST_BASE_URL },
      ),
    );
  }

  it('pins, lists and unpins through the derived client', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const member = await contactOf(context, app, owner.id, 'member@example.com');
    const web = cookieClient(owner.cookie);
    const mobile = bearerClient(member.bearer);

    const created = await runApi(
      web.pins.create({
        payload: {
          chat: expectedJid(member.id),
          messageId: 'msg-1',
          senderName: 'Owner',
          text: 'hello ✅',
          kind: 'text',
        },
      }),
    );
    expect(created).toMatchObject({ messageId: 'msg-1', text: 'hello ✅', pinnedBy: owner.id });

    const listed = await runApi(mobile.pins.list({ query: { chat: expectedJid(owner.id) } }));
    expect(listed.pins.map((pin) => pin.id)).toEqual([created.id]);

    const removed = await runApi(mobile.pins.remove({ params: { id: created.id } }));
    // The `chat` echo is the caller's form of the address.
    expect(removed).toEqual({ ...created, chat: expectedJid(owner.id) });
    const after = await runApi(web.pins.list({ query: { chat: expectedJid(member.id) } }));
    expect(after.pins).toEqual([]);
  });

  it('maps the error envelope, a missing session and a client-side invalid payload', async () => {
    const owner = await bootstrapUser(context, app, 'owner@example.com');
    const web = cookieClient(owner.cookie);

    const missing = await runApi(web.pins.remove({ params: { id: 'nope' } })).catch(
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(ApiError);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });

    const anonymous = await runApi(cookieClient('').pins.list({ query: { chat: 'x' } })).catch(
      (error: unknown) => error,
    );
    expect(anonymous).toMatchObject({ status: 401, code: 'unauthorized' });

    const before = requests;
    const invalid = await runApi(
      web.pins.create({ payload: { chat: 'x', messageId: 'm', senderName: '' } }),
    ).catch((error: unknown) => error);
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(requests).toBe(before);
  });
});
