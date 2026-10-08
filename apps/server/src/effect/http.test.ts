import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import type { Logger } from 'pino';
import { HttpError } from '../errors';
import {
  bootstrapUser,
  createTestContext,
  TEST_BASE_URL,
  testApp,
  type TestContext,
} from '../test-support';
import {
  mountEffectRoutes,
  SOCKET_ADDRESS_HEADER,
  socketAddressOf,
  withErrorEnvelope,
} from './http';

const silentLogger = { error: () => undefined } as unknown as Logger;

describe('effect http adapter', () => {
  let context: TestContext;
  let app: ReturnType<typeof testApp>;

  beforeEach(async () => {
    context = await createTestContext();
    app = testApp(context);
  });

  afterEach(async () => {
    await context.close();
  });

  it('renders an HttpError with its detail, code, message and status', async () => {
    const response = await Effect.runPromise(
      withErrorEnvelope(
        Effect.die(
          new HttpError(409, 'handle_change_too_soon', 'You can change your username again', {
            nextChangeAt: '2026-11-01T00:00:00.000Z',
          }),
        ),
        silentLogger,
        'req-1',
      ),
    );

    const web = HttpServerResponse.toWeb(response);
    expect(web.status).toBe(409);
    expect(await web.json()).toEqual({
      error: {
        nextChangeAt: '2026-11-01T00:00:00.000Z',
        code: 'handle_change_too_soon',
        message: 'You can change your username again',
        requestId: 'req-1',
      },
    });
  });

  it('renders an unknown defect as the 500 internal_error branch and logs it', async () => {
    const logged: Array<unknown> = [];
    const logger = { error: (...args: Array<unknown>) => logged.push(args) } as unknown as Logger;

    const response = await Effect.runPromise(
      withErrorEnvelope(Effect.die(new Error('boom')), logger, 'req-2'),
    );

    const web = HttpServerResponse.toWeb(response);
    expect(web.status).toBe(500);
    expect(await web.json()).toEqual({
      error: { code: 'internal_error', message: 'Internal server error', requestId: 'req-2' },
    });
    expect(logged).toHaveLength(1);
  });

  it('answers 401 without a session and carries the request id into the body', async () => {
    const response = await app.request(`${TEST_BASE_URL}/api/handles/check?handle=ada`);
    expect(response.status).toBe(401);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Authentication required', requestId },
    });
  });

  it('renders a store HttpError through the mounted Effect path', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const response = await app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ handle: 'ab' }),
    });

    expect(response.status).toBe(400);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(await response.json()).toEqual({
      error: { code: 'handle_invalid', message: 'That username is not valid', requestId },
    });
  });

  it('charges the check budget for an invalid query too', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    let limited = 0;
    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await app.request(`${TEST_BASE_URL}/api/handles/check?handle=`, {
        headers: { cookie: alice.cookie },
      });
      if (response.status === 429) {
        limited += 1;
      }
      await response.text();
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('renders an auth-store failure as the 500 envelope and logs it', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const spy = vi
      .spyOn(context.auth.api, 'getSession')
      .mockRejectedValueOnce(new Error('auth store down'));

    try {
      const response = await app.request(`${TEST_BASE_URL}/api/handles/check?handle=ada`, {
        headers: { cookie: alice.cookie },
      });

      expect(response.status).toBe(500);
      const requestId = response.headers.get('x-request-id');
      expect(requestId).toBeTruthy();
      expect(await response.json()).toEqual({
        error: { code: 'internal_error', message: 'Internal server error', requestId },
      });
      expect(context.logOutput()).toContain('unhandled request error');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an excess claim-body key with the legacy zod message', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const response = await app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ handle: 'ada', extra: 1 }),
    });

    expect(response.status).toBe(400);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'Unrecognized key: "extra"', requestId },
    });
  });

  it('keeps the legacy zod message for a missing claim handle', async () => {
    const alice = await bootstrapUser(context, app, 'alice@example.com');
    const response = await app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const requestId = response.headers.get('x-request-id');
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Invalid input: expected string, received undefined',
        requestId,
      },
    });
  });

  it('still rejects a disallowed origin in Hono, before the Effect handler', async () => {
    const response = await app.request(`${TEST_BASE_URL}/api/me/handle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: 'forbidden', message: 'Origin is not allowed' },
    });
  });

  it('strips a forged socket-address header before the Effect handler', async () => {
    const { Hono } = await import('hono');
    const seen: Array<string> = [];
    const wrapper = new Hono<{ Variables: { requestId: string } }>();
    mountEffectRoutes(wrapper, [{ method: 'GET', path: '/api/probe' }], async (request) => {
      const seenRequest = HttpServerRequest.fromWeb(request);
      const program = Effect.map(HttpServerRequest.HttpServerRequest, (serverRequest) =>
        socketAddressOf(serverRequest),
      );
      seen.push(
        await Effect.runPromise(
          Effect.provideService(program, HttpServerRequest.HttpServerRequest, seenRequest),
        ),
      );
      return new Response('ok');
    });
    const response = await wrapper.request('/api/probe', {
      headers: { [SOCKET_ADDRESS_HEADER]: '203.0.113.99' },
    });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toBe('203.0.113.99');
  });
});
