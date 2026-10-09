import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, effectMountsOf, type ZilarEdge } from './app';
import { createEdge } from './effect/edge';
import type { EffectApiMount } from './effect/http-core';
import { HttpError } from './errors';
import { sqlRuntimeFor } from './effect/sql';
import { createTestContext, type TestContext } from './test-support';

// Only `sqlRuntimeFor` is wrapped; every other export is the real module. The
// down-database test breaks the runtime for the next call (T-0675 pattern).
vi.mock('./effect/sql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./effect/sql')>();
  return { ...actual, sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor) };
});

// The error-envelope cases build `createEdge` directly with one extra mount
// whose web handler throws the same errors the old Hono `createTestRoutes`
// threw through `app.onError`.
function createThrowingEdge(context: TestContext): ZilarEdge {
  const throwingMount: EffectApiMount = {
    routes: [
      { method: 'GET', path: '/test/conflict' },
      { method: 'GET', path: '/test/detail' },
      { method: 'GET', path: '/test/hostile-detail' },
      { method: 'GET', path: '/test/boom' },
    ],
    handler: (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname === '/test/conflict') {
        throw new HttpError(409, 'conflict', 'The resource already exists');
      }
      if (url.pathname === '/test/detail') {
        throw new HttpError(422, 'try_later', 'Real message', {
          nextChangeAt: '2026-10-20T00:00:00Z',
        });
      }
      if (url.pathname === '/test/hostile-detail') {
        throw new HttpError(409, 'real_code', 'Real message', {
          code: 'fake_code',
          message: 'Fake message',
          requestId: 'fake-id',
        });
      }
      throw new Error('secret detail');
    },
  };
  const app = createApp({
    db: context.db,
    logger: context.logger,
    config: context.config,
    auth: context.auth,
    adminClient: context.adminClient,
  });
  const mounts = [...effectMountsOf(app), throwingMount];
  const edge = createEdge({
    mounts,
    auth: context.auth,
    config: context.config,
    logger: context.logger,
    health: () =>
      Promise.resolve({
        status: 200,
        body: {
          ok: true,
          name: 'zilar-server',
          version: 'test',
          commit: 'unknown',
          protocolVersion: 0,
          db: 'ok',
        },
      }),
  });
  void app.dispose();
  void edge.dispose();
  return edge;
}

describe('createApp', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.close();
  });

  function testApp() {
    return createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
  }

  function throwingApp() {
    return createThrowingEdge(context);
  }

  it('reports a healthy database', async () => {
    const res = await testApp().request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      name: 'zilar-server',
      db: 'ok',
    });
  });

  it('reports a down database when the health query fails', async () => {
    const app = testApp();
    vi.mocked(sqlRuntimeFor).mockReturnValueOnce({
      runPromise: () => Promise.reject(new Error('connection refused')),
    } as never);
    const res = await app.request('/health');

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: 'down' });
  });

  it('reports the build commit from ZILAR_COMMIT in /health', async () => {
    vi.stubEnv('ZILAR_COMMIT', 'abcdef123456');
    try {
      const res = await testApp().request('/health');

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ commit: 'abcdef123456' });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('returns a 404 JSON body with a request id for unknown routes', async () => {
    const res = await testApp().request('/does-not-exist');

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });

  it('maps an HttpError to its status and code', async () => {
    const res = await throwingApp().request('/test/conflict');

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'conflict', message: 'The resource already exists' },
    });
  });

  it('serializes HttpError detail fields without letting them overwrite code', async () => {
    const res = await throwingApp().request('/test/detail');

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; nextChangeAt: string; requestId: string };
    };
    expect(body.error.code).toBe('try_later');
    expect(body.error.nextChangeAt).toBe('2026-10-20T00:00:00Z');
    expect(body.error.requestId).toBeTruthy();
  });

  it('never lets detail overwrite code, message or requestId', async () => {
    const res = await throwingApp().request('/test/hostile-detail');

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('real_code');
    expect(body.error.message).toBe('Real message');
    expect(body.error.requestId).not.toBe('fake-id');
  });

  it('does not leak details of unknown errors', async () => {
    const res = await throwingApp().request('/test/boom');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('adds x-request-id to every response', async () => {
    const throwing = throwingApp();
    for (const path of ['/health', '/does-not-exist', '/test/conflict']) {
      const res = await throwing.request(path);
      expect(res.headers.get('x-request-id')).toBeTruthy();
    }
  });

  it('lists the 36 Effect module mounts, each route registered on the app', () => {
    const app = testApp();
    const mounts = effectMountsOf(app);
    expect(mounts).toHaveLength(36);
    const registered = app.routes.map((route) => `${route.method} ${route.path}`);
    for (const mount of mounts) {
      for (const route of mount.routes) {
        expect(registered).toContain(`${route.method} ${route.path}`);
      }
    }
  });
});
