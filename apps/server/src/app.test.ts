import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { loadServerConfig } from './config';
import type { PgliteServerDatabase } from './db/client';
import * as schema from './db/schema';
import { HttpError } from './errors';
import { createLogger } from './logger';

const config = loadServerConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/galena',
});
const logger = createLogger(config, { write: () => {} });

function createTestRoutes(): Hono {
  const routes = new Hono();

  routes.get('/conflict', () => {
    throw new HttpError(409, 'conflict', 'The resource already exists');
  });
  routes.get('/boom', () => {
    throw new Error('secret detail');
  });

  return routes;
}

describe('createApp', () => {
  let client: PGlite;
  let db: PgliteServerDatabase;

  beforeEach(() => {
    client = new PGlite();
    db = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  function testApp() {
    const app = createApp({ db, logger, config });
    app.route('/test', createTestRoutes());
    return app;
  }

  it('reports a healthy database', async () => {
    const res = await testApp().request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      name: 'galena-server',
      db: 'ok',
    });
  });

  it('reports a down database when the health query fails', async () => {
    vi.spyOn(db, 'execute').mockRejectedValue(new Error('connection refused'));
    const res = await testApp().request('/health');

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: 'down' });
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
