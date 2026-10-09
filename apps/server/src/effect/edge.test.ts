// Parity tests for the Effect edge (T-0730): request id, CORS, the origin
// guard, request-log masking and the socket-address forwarding.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpServerRequest } from 'effect/http';
import { Effect } from 'effect';
import { createApp } from '../app';
import { createTestContext, TEST_BASE_URL, type TestContext } from '../test-support';
import { REQUEST_ID_HEADER, SOCKET_ADDRESS_HEADER, socketAddressOf } from './http-core';

describe('effect edge', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function edgeApp() {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
  }

  it('echoes an inbound valid x-request-id', async () => {
    const app = edgeApp();
    const res = await app.request(`${TEST_BASE_URL}/health`, {
      headers: { [REQUEST_ID_HEADER]: 'client-id-123' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('client-id-123');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('replaces an invalid inbound x-request-id', async () => {
    const app = edgeApp();
    const res = await app.request(`${TEST_BASE_URL}/health`, {
      headers: { [REQUEST_ID_HEADER]: 'has spaces and/slashes' },
    });
    expect(res.status).toBe(200);
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(requestId).not.toBe('has spaces and/slashes');
  });

  it('answers HEAD on a GET route with 200 and an empty body', async () => {
    const app = edgeApp();
    const res = await app.request(`${TEST_BASE_URL}/health`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('answers a CORS preflight with 204 and the allow-origin headers', async () => {
    const app = edgeApp();
    const origin = context.config.WEB_ORIGINS[0] ?? 'http://localhost:5173';
    const res = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-headers': 'content-type, authorization',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('gives a disallowed origin no allow-origin header on preflight', async () => {
    const app = edgeApp();
    const res = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a POST with a disallowed Origin as 403 forbidden', async () => {
    const app = edgeApp();
    const res = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: 'forbidden', message: 'Origin is not allowed' },
    });
  });

  it('does not answer 403 to a POST with an empty Origin header', async () => {
    const app = edgeApp();
    const res = await app.request(`${TEST_BASE_URL}/api/me`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: '' },
      body: '{}',
    });
    expect(res.status).not.toBe(403);
  });

  it('masks /api/join/<token> in the request log', async () => {
    const app = edgeApp();
    const token = 'secret-join-token-abc123';
    const res = await app.request(`${TEST_BASE_URL}/api/join/${token}`);
    await res.text();
    const output = context.logOutput();
    expect(output).toContain('/api/join/:token');
    expect(output).not.toContain(token);
  });

  it('carries x-zilar-socket-address unknown when there is no socket', async () => {
    const { createEdge } = await import('./edge');
    const seen: Array<string> = [];
    const edge = createEdge({
      mounts: [
        {
          routes: [{ method: 'GET', path: '/api/probe' }],
          handler: (request: Request) => {
            const seenRequest = HttpServerRequest.fromWeb(request);
            const program = Effect.map(HttpServerRequest.HttpServerRequest, (serverRequest) =>
              socketAddressOf(serverRequest),
            );
            return Effect.runPromise(
              Effect.provideService(program, HttpServerRequest.HttpServerRequest, seenRequest),
            ).then((address) => {
              seen.push(address);
              return new Response('ok');
            });
          },
        },
      ],
      auth: { handler: () => Promise.resolve(new Response('not found', { status: 404 })) },
      config: context.config,
      logger: context.logger,
      health: () => Promise.resolve({ status: 200, body: { ok: true } }),
    });
    const response = await edge.request('/api/probe', {
      headers: { [SOCKET_ADDRESS_HEADER]: '203.0.113.99' },
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual(['unknown']);
    await edge.dispose();
  });

  it('carries the serve bindings socket address into the module request', async () => {
    const { createEdge } = await import('./edge');
    const seen: Array<string> = [];
    const edge = createEdge({
      mounts: [
        {
          routes: [{ method: 'GET', path: '/api/probe' }],
          handler: (request: Request) => {
            const seenRequest = HttpServerRequest.fromWeb(request);
            const program = Effect.map(HttpServerRequest.HttpServerRequest, (serverRequest) =>
              socketAddressOf(serverRequest),
            );
            return Effect.runPromise(
              Effect.provideService(program, HttpServerRequest.HttpServerRequest, seenRequest),
            ).then((address) => {
              seen.push(address);
              return new Response('ok');
            });
          },
        },
      ],
      auth: { handler: () => Promise.resolve(new Response('not found', { status: 404 })) },
      config: context.config,
      logger: context.logger,
      health: () => Promise.resolve({ status: 200, body: { ok: true } }),
    });
    // What `serve({ fetch })` passes as the second argument: the node
    // bindings whose `incoming.socket` carries the real TCP address.
    const bindings = { incoming: { socket: { remoteAddress: '203.0.113.7' } } };
    const response = await edge.fetch(
      new Request('http://localhost/api/probe', {
        headers: { [SOCKET_ADDRESS_HEADER]: '198.51.100.99' },
      }),
      bindings,
    );
    expect(response.status).toBe(200);
    // The client-forged header is stripped; the socket address wins.
    expect(seen).toEqual(['203.0.113.7']);
    await edge.dispose();
  });

  it('answers OPTIONS /api/auth/* with 204 before better-auth, like the old cors middleware', async () => {
    const { createEdge } = await import('./edge');
    let authHits = 0;
    const edge = createEdge({
      mounts: [],
      auth: {
        handler: () => {
          authHits += 1;
          return Promise.resolve(new Response('better-auth-response'));
        },
      },
      config: context.config,
      logger: context.logger,
      health: () => Promise.resolve({ status: 200, body: { ok: true } }),
    });
    const origin = context.config.WEB_ORIGINS[0] ?? 'http://localhost:5173';
    const res = await edge.request('/api/auth/sign-in/email', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-headers': 'content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    // The preflight never reaches better-auth: Hono's cors middleware also
    // short-circuited it (verified against the old stack: auth handler hit 0
    // times for OPTIONS, once for POST).
    expect(authHits).toBe(0);
    await edge.dispose();
  });

  it('lists ALL /api/auth/* first, then the mounts, then GET /health', () => {
    const app = edgeApp();
    expect(app.routes[0]).toEqual({ method: 'ALL', path: '/api/auth/*' });
    expect(app.routes[app.routes.length - 1]).toEqual({ method: 'GET', path: '/health' });
    expect(app.routes.length).toBeGreaterThan(10);
  });
});
