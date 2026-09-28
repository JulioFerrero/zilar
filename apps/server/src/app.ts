import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import type { Logger } from 'pino';
import { protocolVersion } from '@galena/protocol';
import { createLitellmAdminClientFromConfig, type LitellmAdminClient } from './ai/litellm-client';
import { createAisRoutes } from './ais/routes';
import type { AiLogger } from './ais/service';
import type { Auth } from './auth/auth';
import { createAuthRoutes } from './auth/routes';
import { createChatsRoutes } from './chats/routes';
import type { ServerConfig } from './config';
import { createKeyCipher, type KeyCipher } from './connections/crypto';
import type { ProviderProbe } from './connections/probe';
import { createConnectionsRoutes, type ConnectionsLogger } from './connections/routes';
import { createContactsRoutes } from './contacts/routes';
import type { ServerDatabase } from './db/client';
import { HttpError } from './errors';
import { createGroupsRoutes } from './groups/routes';
import { serverVersion } from './version';
import type { VoiceEngine } from './voice/engine';
import { createVoiceRoutes } from './voice/routes';
import type { EjabberdAdminClient } from './xmpp/admin-client';
import { createXmppRoutes } from './xmpp/routes';

export interface AppDependencies {
  db: ServerDatabase;
  logger: Logger;
  config: ServerConfig;
  auth: Auth;
  adminClient: EjabberdAdminClient;
  /** Overrides the ffmpeg engine; tests inject a fake. */
  voice?: VoiceEngine;
  /** Overrides the upload size cap; tests use a small one. */
  voiceMaxBytes?: number;
  /** Overrides the connections routes; tests inject a fake probe and key. */
  connections?: {
    cipher?: KeyCipher;
    probe?: ProviderProbe;
    logger?: ConnectionsLogger;
  };
  /** Overrides the AI routes; tests inject a fake LiteLLM and key cipher. */
  ais?: {
    litellm?: LitellmAdminClient;
    cipher?: KeyCipher;
    logger?: AiLogger;
  };
}

const DB_HEALTH_TIMEOUT_MS = 1000;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createApp({
  db,
  logger,
  config,
  auth,
  adminClient,
  voice,
  voiceMaxBytes,
  connections,
  ais,
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

  app.use(
    '/api/*',
    cors({
      origin: config.WEB_ORIGINS,
      credentials: true,
    }),
  );

  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && UNSAFE_METHODS.has(c.req.method) && !allowedOrigins(config).includes(origin)) {
      throw new HttpError(403, 'forbidden', 'Origin is not allowed');
    }
    await next();
  });

  app.all('/api/auth/*', (c) => auth.handler(c.req.raw));
  app.route('/api', createAuthRoutes({ auth, db, config, adminClient, logger }));
  app.route('/api', createContactsRoutes({ auth, db, config }));
  app.route('/api', createGroupsRoutes({ auth, db, config, adminClient, logger }));
  app.route('/api', createChatsRoutes({ auth, db, config }));
  app.route('/api', createXmppRoutes({ auth, db, adminClient, xmppConfig: config.xmpp, logger }));
  app.route(
    '/api',
    createVoiceRoutes({
      auth,
      ...(voice === undefined ? {} : { engine: voice }),
      ...(voiceMaxBytes === undefined ? {} : { maxBytes: voiceMaxBytes }),
    }),
  );

  // Provider-key connections always mount: with no envelope-encryption master
  // key configured, each route answers 503 (`connections_unavailable`) rather
  // than disappearing into a bare 404. The key is validated at startup by the
  // config schema when present. Tests override the cipher and probe so no
  // request ever reaches a real provider.
  const connectionsCipher =
    connections?.cipher ??
    (config.GALENA_KEY_ENCRYPTION_KEY === undefined
      ? undefined
      : createKeyCipher(config.GALENA_KEY_ENCRYPTION_KEY));
  app.route(
    '/api',
    createConnectionsRoutes({
      auth,
      db,
      logger: connections?.logger ?? logger,
      ...(connectionsCipher === undefined ? {} : { cipher: connectionsCipher }),
      ...(connections?.probe === undefined ? {} : { probe: connections.probe }),
    }),
  );

  // AIs always mount. Creating one needs both the key cipher (to seal its
  // gateway key) and the LiteLLM admin client; when either is missing every
  // write route answers 503 (`ais_unavailable`) rather than failing halfway.
  // The LLM client is built from the config here, so `index.ts` needs no change.
  const aisCipher = ais?.cipher ?? connectionsCipher;
  const aisLitellm =
    ais?.litellm ??
    (config.LITELLM_MASTER_KEY === undefined
      ? undefined
      : createLitellmAdminClientFromConfig(config));
  app.route(
    '/api',
    createAisRoutes({
      auth,
      db,
      config,
      adminClient,
      logger: ais?.logger ?? logger,
      ...(aisCipher === undefined ? {} : { cipher: aisCipher }),
      ...(aisLitellm === undefined ? {} : { litellm: aisLitellm }),
    }),
  );

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

function allowedOrigins(config: ServerConfig): string[] {
  const origins = new Set(config.WEB_ORIGINS);
  origins.add(new URL(config.PUBLIC_URL).origin);
  origins.add(new URL(config.BETTER_AUTH_URL).origin);
  return [...origins];
}
