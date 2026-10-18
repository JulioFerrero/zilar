import type { EffectApiMount } from '../effect/http-core';
import { createAisApi } from '../ais/api';
import { approvalFollowerOf } from '../agents/gateway/stop-types';
import { createOnDecided } from '../agents/gateway/approval-on-decided';
import { createApprovalsApi } from '../approvals/api';
import { createAuditApi } from '../audit/api';
import { createConnectionsApi } from '../connections/api';
import { createKeyCipher } from '../connections/crypto';
import { createGifsApi } from '../gifs/api';
import { createIntegrationsApi } from '../integrations/api';
import { createRoutinesApi } from '../routines/api';
import { createToolsApi, type ToolsApiDependencies } from '../tools/api';
import { createVoiceTranscriptionApi } from '../voice-transcription/api';
import { createVoiceApi } from '../voice/api';
import { createXmppApi } from '../xmpp/api';
import type { RouteWiring } from './deps';
import { opt } from './opt';

export function aiRoutes({ deps, base, audit, mailer, gateway }: RouteWiring): EffectApiMount[] {
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
