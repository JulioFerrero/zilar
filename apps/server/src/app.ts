import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import type { Logger } from 'pino';
import { protocolVersion } from '@galena/protocol';
import type { Auth } from './auth/auth';
import { createAuthRoutes } from './auth/routes';
import type { ServerConfig } from './config';
import type { ServerDatabase } from './db/client';
import { HttpError } from './errors';
import { serverVersion } from './version';

export interface AppDependencies {
  db: ServerDatabase;
  logger: Logger;
  config: ServerConfig;
  auth: Auth;
}

const DB_HEALTH_TIMEOUT_MS = 1000;

export function createApp({
  db,
  logger,
  config,
  auth,
}: AppDependencies): Hono<{ Variables: RequestIdVariables }> {
  const app = new Hono<{ Variables: RequestIdVariables }>();

  app.use('*', requestId());

  app.use('*', async (c, next) => {
    const start = performance.now();
    const fields = { method: c.req.method, path: c.req.path, requestId: c.get('requestId') };

    try {
      await next();
    } catch (error) {
      logger.info(
        { ...fields, status: statusFor(error), durationMs: durationSince(start) },
        'request',
      );
      throw error;
    }

    logger.info({ ...fields, status: c.res.status, durationMs: durationSince(start) }, 'request');
  });

  app.all('/api/auth/*', (c) => auth.handler(c.req.raw));
  app.route('/api', createAuthRoutes({ auth, db, config }));

  app.get('/health', async (c) => {
    const up = await isDatabaseUp(db);
    return c.json(
      {
        ok: up,
        name: 'galena-server',
        version: serverVersion,
        protocolVersion,
        db: up ? 'ok' : 'down',
      },
      up ? 200 : 503,
    );
  });

  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: 'Not found', requestId: c.get('requestId') } },
      404,
    ),
  );

  app.onError((error, c) => {
    const requestIdValue = c.get('requestId');

    if (error instanceof HttpError) {
      return c.json(
        {
          error: { code: error.code, message: error.message, requestId: requestIdValue },
        },
        error.status,
      );
    }

    logger.error({ err: error, requestId: requestIdValue }, 'unhandled request error');
    return c.json(
      {
        error: {
          code: 'internal_error',
          message: 'Internal server error',
          requestId: requestIdValue,
        },
      },
      500,
    );
  });

  return app;
}

async function isDatabaseUp(db: ServerDatabase): Promise<boolean> {
  try {
    await withTimeout(Promise.resolve(db.execute(sql`select 1`)), DB_HEALTH_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('database health check timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function statusFor(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}

function durationSince(start: number): number {
  return Math.round(performance.now() - start);
}
