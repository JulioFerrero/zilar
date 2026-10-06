import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId, type RequestIdVariables } from 'hono/request-id';
import type { Logger } from 'pino';
import { protocolVersion } from '@zilar/protocol';
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
import { CurrentMailer, createMailer } from './auth/mailer';
import { createSetupRoutes, type SetupRoutesDependencies } from './setup/routes';
import { createIntegrationsRoutes, createGetBotToken } from './integrations/routes';
import { settingsCipherFor } from './setup/settings';
import { createChatsRoutes } from './chats/routes';
import { createChatPrefsRoutes } from './chat-prefs/routes';
import { createChatFoldersRoutes } from './chat-folders/routes';
import type { ServerConfig } from './config';
import { loadPushConfig, type PushConfig } from './push/config';
import { createDraftsRoutes } from './drafts/routes';
import { createKeyCipher, type KeyCipher } from './connections/crypto';
import type { ProviderProbe } from './connections/probe';
import { createConnectionsRoutes, type ConnectionsLogger } from './connections/routes';
import { createBlocksRoutes } from './blocks/routes';
import { createContactsRoutes } from './contacts/routes';
import { createContactRequestsRoutes } from './contact-requests/routes';
import { createDirectoryRoutes } from './directory/routes';
import { createHandlesRoutes } from './handles/routes';
import type { ServerDatabase } from './db/client';
import { HttpError } from './errors';
import { createGroupsRoutes } from './groups/routes';
import { createInviteLinksRoutes, type TestInviteLinksOverrides } from './invite-links/routes';
import { createPinsRoutes } from './pins/routes';
import { createPushRoutes } from './push/routes';
import { createRolesRoutes } from './roles/routes';
import { createSearchRoutes, type SearchRoutesDependencies } from './search/routes';
import { createMediaRoutes } from './media/routes';
import { createGifsRoutes } from './gifs/routes';
import { createAvatarsRoutes } from './avatars/routes';
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
import { createVoiceTranscriptionRoutes } from './voice-transcription/routes';
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
  /** T-0161: the live mailer (swapped by the setup screen, no restart). */
  mailer?: CurrentMailer;
  /** T-0161: overrides the setup routes (tests inject a fake sender). */
  setup?:
    | Partial<
        Pick<
          SetupRoutesDependencies,
          'limiter' | 'getClientIp' | 'trustedProxyHops' | 'sendTestCode'
        >
      >
    | undefined;
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
  /** T-0165: avatar storage dir override; defaults to the parsed config. */
  avatarStorageDir?: string;
  /** T-0165: injected in tests so the avatar upload rate window can advance. */
  avatarNow?: () => number;
  /** T-0165: overrides the avatar upload limiter (tests inject a window). */
  avatarUploadLimiter?: { allow: (key: string) => boolean };
  /** T-0120: injected in tests so the upload rate window can advance. */
  stickerNow?: () => number;
  /** T-0120: overrides the sticker upload limiter (cap tests inject a pass). */
  uploadLimiter?: { allow: (key: string) => boolean };
  /** T-0123: overrides the Telegram import client (tests inject a fake). */
  telegramClient?: import('./stickers/telegram-import').TelegramClient;
  /** T-0123: overrides the Telegram import limiter (tests inject a window). */
  telegramImportNow?: () => number;
  /** T-0170: overrides the voice transcription routes (tests inject fakes). */
  voiceTranscription?:
    | Partial<
        Pick<
          import('./voice-transcription/routes').VoiceTranscriptionRoutesDependencies,
          'transcriptLimiter' | 'settingsLimiter' | 'now' | 'audioFetcher' | 'transcribe'
        >
      >
    | undefined;
  /** T-0162: overrides the integrations routes (tests inject fake senders). */
  integrations?:
    | Partial<
        Pick<
          import('./integrations/routes').IntegrationsRoutesDependencies,
          | 'createTelegram'
          | 'telegramLimiter'
          | 'emailLimiter'
          | 'now'
          | 'sendTestMail'
          | 'swapMailer'
        >
      >
    | undefined;
  /**
   * T-0119: push env (kept separate from the server config so push stays
   * optional). Absent = push off (every push route answers 404).
   */
  push?: PushConfig;
  /** T-0122: overrides the GIF provider port; tests inject the fake. */
  gifProvider?: import('./gifs/provider').GifProvider;
  /** T-0122: overrides the GIF media fetch; tests inject a fake. */
  gifMediaFetcher?: import('./gifs/routes').GifsRoutesDependencies['mediaFetcher'];
  /** T-0122: injected in tests so token expiry and the rate window advance. */
  gifNow?: () => number;
}

const DB_HEALTH_TIMEOUT_MS = 1000;
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createApp({
  db,
  logger,
  config,
  auth,
  adminClient,
  mailer,
  setup,
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
  avatarStorageDir,
  avatarNow,
  avatarUploadLimiter,
  telegramClient,
  telegramImportNow,
  voiceTranscription,
  integrations,
  push,
  gifProvider,
  gifMediaFetcher,
  gifNow,
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
  // First-run setup (T-0161): public while no user exists, same 404 as an
  // unknown route once setup is done. Allowlisted in the authz sweep.
  // Without an explicit mailer the routes build one from the config, like
  // `index.ts` does for production.
  const currentMailer = mailer ?? new CurrentMailer(createMailer(config, logger));
  app.route(
    '/api',
    createSetupRoutes({
      auth,
      db,
      config,
      mailer: currentMailer,
      logger,
      audit: auditRecorder,
      ...setup,
    }),
  );
  app.route('/api', createContactsRoutes({ auth, db, config }));
  // @usernames and contact requests (T-0163): session-required, rate
  // limited; the sweep asserts every one of them answers 401 unauthenticated.
  app.route('/api', createHandlesRoutes({ auth, db, audit: auditRecorder }));
  app.route(
    '/api',
    createContactRequestsRoutes({ auth, db, config, adminClient, audit: auditRecorder }),
  );
  // User blocks (T-0171): session-required, write-rate-limited; the sweep
  // asserts every one of them answers 401 unauthenticated.
  app.route('/api', createBlocksRoutes({ auth, db, audit: auditRecorder }));
  // Public groups and channels (T-0164): the Explore directory and the
  // exact `@handle` lookup — public rows only, session-required, rate
  // limited; the sweep asserts both answer 401 unauthenticated.
  app.route('/api', createDirectoryRoutes({ auth, db }));
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
  app.route('/api', createChatFoldersRoutes({ auth, db, config }));
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
  // Media gallery (T-0431) mounts the same way: without an archive pool every
  // request answers 501 `media_unavailable` instead of 404ing.
  app.route(
    '/api',
    createMediaRoutes({
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
  // The bot token resolves per request: env wins, else the stored
  // integrations value, else none (T-0162), so saving needs no restart.
  const getBotToken = createGetBotToken({
    config,
    db,
    cipher: settingsCipherFor(config),
    logger,
  });
  app.route(
    '/api',
    createStickersRoutes({
      auth,
      db,
      config,
      storageDir: stickerStorageDir ?? config.STICKER_STORAGE_DIR,
      audit: auditRecorder,
      getBotToken,
      ...(stickerNow === undefined ? {} : { now: stickerNow }),
      ...(uploadLimiter === undefined ? {} : { uploadLimiter }),
      ...(telegramClient === undefined ? {} : { telegramClient }),
      ...(telegramImportNow === undefined ? {} : { now: telegramImportNow }),
    }),
  );
  // Avatars (T-0165): upload / remove / serve profile pictures for
  // people, AIs, groups and channels. The storage dir comes from
  // `AVATAR_STORAGE_DIR`; tests override it with a temp dir.
  app.route(
    '/api',
    createAvatarsRoutes({
      auth,
      db,
      config,
      storageDir: avatarStorageDir ?? config.AVATAR_STORAGE_DIR,
      audit: auditRecorder,
      ...(avatarNow === undefined ? {} : { now: avatarNow }),
      ...(avatarUploadLimiter === undefined ? {} : { uploadLimiter: avatarUploadLimiter }),
    }),
  );
  // Integration settings (T-0162 + Email): owner-only; everyone else gets
  // the same 404 as an unknown route. Covered by the 401 sweep as
  // session-required routes (never allowlisted).
  app.route(
    '/api',
    createIntegrationsRoutes({
      auth,
      db,
      config,
      logger,
      mailer: currentMailer,
      audit: auditRecorder,
      ...integrations,
    }),
  );
  app.route('/api', createAuditRoutes({ auth, db }));
  // GIFs (T-0122): search, trending and the media proxy. Mounted always: an
  // unconfigured provider answers 501 `gifs_unavailable` instead of 404ing,
  // so the web can hide the tab.
  app.route(
    '/api',
    createGifsRoutes({
      auth,
      config,
      logger,
      ...(gifProvider === undefined ? {} : { provider: gifProvider }),
      ...(gifMediaFetcher === undefined ? {} : { mediaFetcher: gifMediaFetcher }),
      ...(gifNow === undefined ? {} : { now: gifNow }),
    }),
  );
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
  // Voice transcripts on demand (T-0170): the enabled flag plus the
  // transcript route for any signed-in user, and the owner-only endpoint
  // settings. Covered by the 401 sweep as session-required routes (never
  // allowlisted). Tests inject the audio fetcher and the transcriber so no
  // request ever reaches ejabberd or a real provider.
  app.route(
    '/api',
    createVoiceTranscriptionRoutes({
      auth,
      db,
      config,
      logger,
      audit: auditRecorder,
      ...voiceTranscription,
    }),
  );

  // Provider-key connections always mount: with no envelope-encryption master
  // key configured, each route answers 503 (`connections_unavailable`) rather
  // than disappearing into a bare 404. The key is validated at startup by the
  // config schema when present. Tests override the cipher and probe so no
  // request ever reaches a real provider.
  const connectionsCipher =
    connections?.cipher ??
    (config.ZILAR_KEY_ENCRYPTION_KEY === undefined
      ? undefined
      : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY));
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
        name: 'zilar-server',
        version: serverVersion,
        commit: process.env.ZILAR_COMMIT ?? 'unknown',
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
          // `detail` first: a detail key (e.g. a future `code`) can never
          // overwrite the real `code`, `message` or `requestId`.
          error: {
            ...error.detail,
            code: error.code,
            message: error.message,
            requestId: requestIdValue,
          },
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

// Join tokens (T-0115), sign-up invite codes, GIF media tokens (T-0122) and
// avatar ids (unguessable uuids) are bearer secrets, so the request log
// redacts every segment after `/api/join/`, `/api/invites/`,
// `/api/gifs/media/` and `/api/avatars/`
// (`/api/join/<token>` and any variant such as a trailing slash, which 404s in
// routing but still reaches this log line).
function logPath(path: string): string {
  if (path.startsWith('/api/join/')) {
    return '/api/join/:token';
  }
  if (path.startsWith('/api/gifs/media/')) {
    return '/api/gifs/media/:token';
  }
  if (path.startsWith('/api/avatars/')) {
    return '/api/avatars/:id';
  }
  return path.startsWith('/api/invites/') ? '/api/invites/:code' : path;
}

function allowedOrigins(config: ServerConfig): string[] {
  const origins = new Set(config.WEB_ORIGINS);
  origins.add(new URL(config.PUBLIC_URL).origin);
  origins.add(new URL(config.BETTER_AUTH_URL).origin);
  return [...origins];
}
