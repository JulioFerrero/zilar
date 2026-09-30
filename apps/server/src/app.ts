import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import type { Logger } from 'pino';
import { protocolVersion } from '@galena/protocol';
import { createLitellmAdminClientFromConfig, type LitellmAdminClient } from './ai/litellm-client';
import { createAisRoutes } from './ais/routes';
import type { AiLogger } from './ais/service';
import { createActionGateway, type ActionGateway } from './actions/gateway';
import type { AlwaysEligiblePredicate } from './approvals/service';
import { createApprovalsRoutes } from './approvals/routes';
import { createAuditRecorder, type AuditRecorder } from './audit/service';
import { createAuditRoutes } from './audit/routes';
import type { Auth } from './auth/auth';
import { createAuthRoutes } from './auth/routes';
import { createChatsRoutes } from './chats/routes';
import { createChatPrefsRoutes } from './chat-prefs/routes';
import type { ServerConfig } from './config';
import { loadPushConfig, type PushConfig } from './push/config';
import { createDraftsRoutes } from './drafts/routes';
import { createKeyCipher, type KeyCipher } from './connections/crypto';
import type { ProviderProbe } from './connections/probe';
import { createConnectionsRoutes, type ConnectionsLogger } from './connections/routes';
import { createContactsRoutes } from './contacts/routes';
import type { ServerDatabase } from './db/client';
import { HttpError } from './errors';
import { createGroupsRoutes } from './groups/routes';
import { createInviteLinksRoutes, type TestInviteLinksOverrides } from './invite-links/routes';
import { createPinsRoutes } from './pins/routes';
import { createPushRoutes } from './push/routes';
import { createRolesRoutes } from './roles/routes';
import { createSearchRoutes, type SearchRoutesDependencies } from './search/routes';
import { createStickersRoutes } from './stickers/routes';
import { createTopicsRoutes } from './topics/routes';
import { createMachinesRoutes } from './machines/routes';
import { createDbMachineRegistry, type DbMachineRegistry } from './machines/registry';
import { serverVersion } from './version';
import { createToolsRoutes, type ToolsRoutesDependencies } from './tools/routes';
import { createRoutinesRoutes } from './routines/routes';
import type { ToolRunner } from './tools/types';
import type { VoiceEngine } from './voice/engine';
import { createVoiceRoutes } from './voice/routes';
import type { EjabberdAdminClient } from './xmpp/admin-client';
import { createXmppRoutes } from './xmpp/routes';

// Test seam for the join rate windows (T-0115): the invite-links tests set
// an injected clock and client IP through `setTestAppInviteLinks` so the
// windows can advance without waiting. Production never sets it.
let testInviteLinksOverrides: TestInviteLinksOverrides | undefined;

export function setTestAppInviteLinks(overrides: TestInviteLinksOverrides | undefined): void {
  testInviteLinksOverrides = overrides;
}

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
  /** Injected by index.ts when the runner hub is on; absent = hub off. */
  isMachineOnline?: (machineId: string) => boolean;
  /**
   * Shared with the runner hub so route-level notifies (approve / revoke)
   * reach the same listener set. Defaults to a fresh registry over `db`,
   * which is fine when no hub is running.
   */
  machineRegistry?: DbMachineRegistry;
  /**
   * Audit recorder shared with the approvals and machines routes. Tests may
   * pass a recorder backed by the same database to observe what the routes
   * write; production wires the recorder built above.
   */
  audit?: AuditRecorder;
  /**
   * Action gateway (T-0090): wires `onDecided` into the approvals route so
   * a successful decision executes the matching pending action. Production
   * passes the gateway built in `index.ts` with an empty adapter
   * registry; tests pass their own to inject fake adapters.
   */
  actionGateway?: ActionGateway;
  /**
   * T-0099: predicate the approvals route uses to decide whether an
   * `approve_always` decision is a real choice. Built from the
   * adapter registry by `buildAlwaysEligible` in `actions/registry.ts`.
   * Absent = nothing is always-eligible.
   */
  alwaysEligible?: AlwaysEligiblePredicate;
  /**
   * T-0103: tool runner port the tools routes use for manual runs. Absent
   * = no runner (every run answers 501 `runner_unavailable`); T-0105
   * wires the real sandbox.
   */
  toolRunner?: ToolRunner;
  /**
   * T-0117: read-only pool on the ejabberd MAM archive. Absent = search is
   * unconfigured (every search answers 501 `search_unavailable`).
   */
  archive?: SearchRoutesDependencies['archive'];
  /** T-0117: injected in tests so the search rate window can advance. */
  searchNow?: () => number;
  /** T-0120: sticker storage dir override; defaults to the parsed config. */
  stickerStorageDir?: string;
  /** T-0120: injected in tests so the upload rate window can advance. */
  stickerNow?: () => number;
  /** T-0120: overrides the sticker upload limiter (cap tests inject a pass). */
  uploadLimiter?: { allow: (key: string) => boolean };
  /**
   * T-0119: push env (kept separate from the server config so push stays
   * optional). Absent = push off (every push route answers 404).
   */
  push?: PushConfig;
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
  isMachineOnline,
  machineRegistry,
  audit,
  actionGateway,
  alwaysEligible,
  toolRunner,
  archive,
  searchNow,
  stickerStorageDir,
  stickerNow,
  uploadLimiter,
  push,
}: AppDependencies): Hono<{ Variables: RequestIdVariables }> {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  const auditRecorder = audit ?? createAuditRecorder({ db, logger });
  // Default gateway: empty registry. Every action is denied
  // `unknown_action` until a later task registers an adapter, and there is
  // no HTTP route to request an action yet.
  const gateway =
    actionGateway ??
    createActionGateway({
      db,
      adapters: {},
      audit: auditRecorder,
      logger,
    });

  app.use('*', requestId());

  app.use('*', async (c, next) => {
    const start = performance.now();
    // T-0115: the join token is a bearer secret — `/api/join/<token>` is
    // logged as `/api/join/:token` so the raw token never reaches the
    // server log, on success or on error.
    const fields = {
      method: c.req.method,
      path: logPath(c.req.path),
      requestId: c.get('requestId'),
    };

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
  app.route(
    '/api',
    createMachinesRoutes({
      auth,
      db,
      logger,
      audit: auditRecorder,
      registry: machineRegistry ?? createDbMachineRegistry(db),
      ...(isMachineOnline === undefined ? {} : { isMachineOnline }),
    }),
  );
  app.route(
    '/api',
    createGroupsRoutes({ auth, db, config, adminClient, logger, audit: auditRecorder }),
  );
  app.route(
    '/api',
    createInviteLinksRoutes({
      auth,
      db,
      config,
      adminClient,
      logger,
      audit: auditRecorder,
      ...(testInviteLinksOverrides === undefined ? {} : testInviteLinksOverrides),
    }),
  );
  app.route(
    '/api',
    createRolesRoutes({ auth, db, config, adminClient, logger, audit: auditRecorder }),
  );
  app.route('/api', createPinsRoutes({ auth, db, config, audit: auditRecorder }));
  app.route(
    '/api',
    createTopicsRoutes({ auth, db, config, adminClient, logger, audit: auditRecorder }),
  );
  app.route('/api', createChatsRoutes({ auth, db, config }));
  app.route('/api', createChatPrefsRoutes({ auth, db, config }));
  // Push devices and settings (T-0119) mount always: with push off or
  // unconfigured every route answers 404/503 instead of disappearing, so
  // the web can show the matching state.
  app.route(
    '/api',
    createPushRoutes({
      auth,
      db,
      config,
      push: push ?? loadPushConfig({}),
      adminClient,
      logger,
    }),
  );
  // Message search (T-0117) mounts always: without an archive pool every
  // search answers 501 `search_unavailable` instead of 404ing, so the web
  // can hide the feature. Never used by the AI gateway.
  app.route(
    '/api',
    createSearchRoutes({
      auth,
      db,
      config,
      logger,
      ...(archive === undefined ? {} : { archive }),
      ...(searchNow === undefined ? {} : { now: searchNow }),
    }),
  );
  app.route('/api', createDraftsRoutes({ auth }));
  // Stickers (T-0120): packs, uploads and file serving. The storage dir
  // comes from `STICKER_STORAGE_DIR`; tests override it with a temp dir.
  app.route(
    '/api',
    createStickersRoutes({
      auth,
      db,
      config,
      storageDir: stickerStorageDir ?? config.STICKER_STORAGE_DIR,
      audit: auditRecorder,
      ...(stickerNow === undefined ? {} : { now: stickerNow }),
      ...(uploadLimiter === undefined ? {} : { uploadLimiter }),
    }),
  );
  app.route('/api', createAuditRoutes({ auth, db }));
  app.route(
    '/api',
    createApprovalsRoutes({
      auth,
      db,
      audit: auditRecorder,
      logger,
      onDecided: (approvalId) => gateway.onApprovalDecided(approvalId),
      ...(alwaysEligible === undefined ? {} : { alwaysEligible }),
    }),
  );
  const toolsDeps: ToolsRoutesDependencies = {
    auth,
    db,
    audit: auditRecorder,
    ...(toolRunner === undefined ? {} : { toolRunner }),
  };
  app.route('/api', createToolsRoutes(toolsDeps));
  app.route('/api', createRoutinesRoutes({ auth, db, audit: auditRecorder }));
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
      audit: auditRecorder,
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

// Join tokens (T-0115) and sign-up invite codes are bearer secrets, so the
// request log redacts every segment after `/api/join/` and `/api/invites/`
// (`/api/join/<token>` and any variant such as a trailing slash, which 404s in
// routing but still reaches this log line).
function logPath(path: string): string {
  if (path.startsWith('/api/join/')) {
    return '/api/join/:token';
  }
  return path.startsWith('/api/invites/') ? '/api/invites/:code' : path;
}

function allowedOrigins(config: ServerConfig): string[] {
  const origins = new Set(config.WEB_ORIGINS);
  origins.add(new URL(config.PUBLIC_URL).origin);
  origins.add(new URL(config.BETTER_AUTH_URL).origin);
  return [...origins];
}
