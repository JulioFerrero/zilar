import { createActionGateway } from './actions/gateway';
import { createAisApi } from './ais/api';
import { createOnDecided } from './agents/gateway/approval-on-decided';
import { approvalFollowerOf } from './agents/gateway/stop-types';
import type { AppDependencies, BaseDeps, RouteWiring } from './app/deps';
import { opt } from './app/opt';
import { messagingRoutes } from './app/routes-messaging';
import { createApprovalsApi } from './approvals/api';
import { createAuditApi } from './audit/api';
import { createAuditRecorder } from './audit/recorder';
import { CurrentMailer, createMailer } from './auth/mailer';
import { createAvatarsApi } from './avatars/api';
import { createBackgroundsApi } from './backgrounds/api';
import { createCardMediaApi } from './card-media/api';
import { createConnectionsApi } from './connections/api';
import { createKeyCipher } from './connections/crypto';
import { createEdge, type EdgeHealth, type ZilarEdge } from './effect/edge';
import type { EffectApiMount } from './effect/http-core';
import { registerSqlRuntime } from './effect/sql';
import { createGifsApi } from './gifs/api';
import { createHealthCheck } from './health';
import { createIntegrationsApi } from './integrations/api';
import { createGetBotToken } from './integrations/routes';
import type { TestInviteLinksOverrides } from './invite-links/api';
import { createRoutinesApi } from './routines/api';
import { settingsCipherFor } from './setup/settings';
import { createStickerConverter } from './stickers/convert';
import { createStickersApi } from './stickers/api';
import { createToolsApi, type ToolsApiDependencies } from './tools/routes';
import { createVoiceTranscriptionApi } from './voice-transcription/api';
import { createVoiceApi } from './voice/api';
import { createXmppApi } from './xmpp/api';

function aiRoutes({ deps, base, audit, mailer, gateway }: RouteWiring): EffectApiMount[] {
  const { config, logger } = base;
  const mounts: EffectApiMount[] = [];
  // Owner-only; everyone else gets the same 404 as an unknown route.
  const integrationsApi = createIntegrationsApi({
    ...base,
    mailer,
    audit,
    ...deps.integrations,
  });
  mounts.push(integrationsApi);
  const auditApi = createAuditApi({ ...base });
  mounts.push(auditApi);
  // Mounted always: an unconfigured provider answers 501, so the web can hide the tab.
  const gifsApi = createGifsApi({
    ...base,
    ...opt('provider', deps.gifProvider),
    ...opt('mediaFetcher', deps.gifMediaFetcher),
    ...opt('now', deps.gifNow),
  });
  mounts.push(gifsApi);
  const approvalsApi = createApprovalsApi({
    ...base,
    audit,
    onDecided: createOnDecided({
      runAction: (approvalId) => gateway.onApprovalDecided(approvalId),
      follower: () => approvalFollowerOf(deps.getGateway?.() ?? null),
    }),
    ...opt('alwaysEligible', deps.alwaysEligible),
  });
  mounts.push(approvalsApi);
  const toolsDeps: Omit<ToolsApiDependencies, 'logger'> = {
    auth: base.auth,
    db: base.db,
    audit,
    ...opt('toolRunner', deps.toolRunner),
  };
  const toolsApi = createToolsApi({ ...toolsDeps, logger });
  mounts.push(toolsApi);
  const routinesApi = createRoutinesApi({ ...base, audit, mucDomain: config.xmpp.mucDomain });
  mounts.push(routinesApi);
  const xmppApi = createXmppApi({
    ...base,
    adminClient: deps.adminClient,
    xmppConfig: config.xmpp,
  });
  mounts.push(xmppApi);
  const voiceApi = createVoiceApi({
    ...base,
    ...opt('engine', deps.voice),
    ...opt('maxBytes', deps.voiceMaxBytes),
  });
  mounts.push(voiceApi);
  // Session-required, never allowlisted in the 401 sweep; tests inject the fetcher and
  // transcriber so no request reaches ejabberd or a provider.
  const voiceTranscriptionApi = createVoiceTranscriptionApi({
    ...base,
    audit,
    ...deps.voiceTranscription,
  });
  mounts.push(voiceTranscriptionApi);
  // Mounted always: with no master key each route answers 503, never a bare 404. Tests
  // override the cipher and probe.
  const connectionsCipher =
    deps.connections?.cipher ??
    (config.ZILAR_KEY_ENCRYPTION_KEY === undefined
      ? undefined
      : createKeyCipher(config.ZILAR_KEY_ENCRYPTION_KEY));
  const connectionsApi = createConnectionsApi({
    ...base,
    logger: deps.connections?.logger ?? logger,
    ...opt('cipher', connectionsCipher),
    ...opt('probe', deps.connections?.probe),
  });
  mounts.push(connectionsApi);
  // Mounted always: without the key cipher every write answers 503, never a half-write.
  const aisCipher = deps.ais?.cipher ?? connectionsCipher;
  const aisApi = createAisApi({
    ...base,
    adminClient: deps.adminClient,
    logger: deps.ais?.logger ?? logger,
    audit,
    ...opt('cloud', deps.ais?.cloud),
    ...opt('cipher', aisCipher),
    ...opt('getGateway', deps.getGateway),
  });
  mounts.push(aisApi);

  return mounts;
}
function mediaRoutes({ deps, base, audit }: RouteWiring): EffectApiMount[] {
  const { config } = base;
  const mounts: EffectApiMount[] = [];
  // The bot token resolves per request: env wins, else the stored integrations value.
  const getBotToken = createGetBotToken({
    ...base,
    cipher: settingsCipherFor(config),
  });
  const stickersDeps = {
    ...base,
    storageDir: deps.stickerStorageDir ?? config.STICKER_STORAGE_DIR,
    audit,
    getBotToken,
    converter: createStickerConverter({
      warn: (summary, stderrTail) =>
        base.logger.warn({ stderrTail }, `sticker conversion failed: ${summary}`),
    }),
    ...opt('now', deps.stickerNow),
    ...opt('uploadLimiter', deps.uploadLimiter),
    ...opt('telegramClient', deps.telegramClient),
    ...opt('now', deps.telegramImportNow),
  };
  const stickersApi = createStickersApi(stickersDeps);
  mounts.push(stickersApi);
  const avatarsApi = createAvatarsApi({
    ...base,
    storageDir: deps.avatarStorageDir ?? config.AVATAR_STORAGE_DIR,
    audit,
    ...opt('now', deps.avatarNow),
    ...opt('uploadLimiter', deps.avatarUploadLimiter),
  });
  mounts.push(avatarsApi);
  const backgroundsApi = createBackgroundsApi({
    ...base,
    storageDir: deps.backgroundStorageDir ?? config.BACKGROUND_STORAGE_DIR,
    ...opt('now', deps.backgroundNow),
    ...opt('uploadLimiter', deps.backgroundUploadLimiter),
  });
  mounts.push(backgroundsApi);

  const cardMediaApi = createCardMediaApi({
    ...base,
    storageDir: deps.cardMediaStorageDir ?? config.CARD_MEDIA_STORAGE_DIR,
  });
  mounts.push(cardMediaApi);

  return mounts;
}
function healthRoutes({ deps, base }: RouteWiring): () => Promise<EdgeHealth> {
  return createHealthCheck({ db: base.db, adminClient: deps.adminClient });
}
// Read by the authz sweep and the scheduler test through `app.routes`.
export type { EdgeHealth, ZilarEdge };

export type { AppDependencies };

// Test seam: the invite-links tests inject a clock and client IP; production never sets it.
let testInviteLinksOverrides: TestInviteLinksOverrides | undefined;

export function setTestAppInviteLinks(overrides: TestInviteLinksOverrides | undefined): void {
  testInviteLinksOverrides = overrides;
}

export function createApp(deps: AppDependencies): ZilarEdge {
  const { db, config, logger, auth } = deps;
  // Bind the `effect/sql` runtime once per database handle before building routes.
  registerSqlRuntime(db, config.DATABASE_URL);
  const audit = deps.audit ?? createAuditRecorder({ db, logger });
  // Default gateway: an empty registry, so every action is denied until an adapter registers.
  const gateway =
    deps.actionGateway ??
    createActionGateway({
      db,
      adapters: {},
      audit,
      logger,
    });
  const mailer = deps.mailer ?? new CurrentMailer(createMailer(config, logger));

  const base: BaseDeps = { db, config, logger, auth };
  const wiring: RouteWiring = {
    deps,
    base,
    audit,
    mailer,
    gateway,
    inviteLinksOverrides: testInviteLinksOverrides,
  };

  const mounts: EffectApiMount[] = [
    ...messagingRoutes(wiring),
    ...mediaRoutes(wiring),
    ...aiRoutes(wiring),
  ];
  const health = healthRoutes(wiring);

  const edge = createEdge({ mounts, auth, config, logger, health });
  return edge;
}
