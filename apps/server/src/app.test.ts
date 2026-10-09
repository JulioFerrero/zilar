import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { HttpError } from './errors';
import { sqlRuntimeFor } from './effect/sql';
import { createTestContext, type TestContext } from './test-support';

// Only `sqlRuntimeFor` is wrapped; every other export is the real module. The
// down-database test breaks the runtime for the next call (T-0675 pattern).
vi.mock('./effect/sql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./effect/sql')>();
  return { ...actual, sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor) };
});

function createTestRoutes(): Hono {
  const routes = new Hono();

  routes.get('/conflict', () => {
    throw new HttpError(409, 'conflict', 'The resource already exists');
  });
  routes.get('/detail', () => {
    throw new HttpError(422, 'try_later', 'Real message', { nextChangeAt: '2026-10-20T00:00:00Z' });
  });
  routes.get('/hostile-detail', () => {
    throw new HttpError(409, 'real_code', 'Real message', {
      code: 'fake_code',
      message: 'Fake message',
      requestId: 'fake-id',
    });
  });
  routes.get('/boom', () => {
    throw new Error('secret detail');
  });

  return routes;
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
    const app = createApp({
      db: context.db,
      logger: context.logger,
      config: context.config,
      auth: context.auth,
      adminClient: context.adminClient,
    });
    app.route('/test', createTestRoutes());
    return app;
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
    const res = await testApp().request('/test/conflict');

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'conflict', message: 'The resource already exists' },
    });
  });

  it('serializes HttpError detail fields without letting them overwrite code', async () => {
    const res = await testApp().request('/test/detail');

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; nextChangeAt: string; requestId: string };
    };
    expect(body.error.code).toBe('try_later');
    expect(body.error.nextChangeAt).toBe('2026-10-20T00:00:00Z');
    expect(body.error.requestId).toBeTruthy();
  });

  it('never lets detail overwrite code, message or requestId', async () => {
    const res = await testApp().request('/test/hostile-detail');

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe('real_code');
    expect(body.error.message).toBe('Real message');
    expect(body.error.requestId).not.toBe('fake-id');
  });

  it('does not leak details of unknown errors', async () => {
    const res = await testApp().request('/test/boom');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('adds x-request-id to every response', async () => {
    for (const path of ['/health', '/does-not-exist', '/test/conflict']) {
      const res = await testApp().request(path);
      expect(res.headers.get('x-request-id')).toBeTruthy();
    }
  });
});
