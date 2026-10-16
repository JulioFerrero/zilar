// The integration, AI, approvals, tools and voice routes `createApp` mounts
// last, in mount order (T-1460, plan #48).
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

/** The second group of mounts: integrations up to AIs, in mount order. */
export function aiRoutes({ deps, base, audit, mailer, gateway }: RouteWiring): EffectApiMount[] {
  const { config, logger } = base;
  const mounts: EffectApiMount[] = [];
  // Integration settings (T-0162 + Email): owner-only; everyone else gets
  // the same 404 as an unknown route. Covered by the 401 sweep as
  // session-required routes (never allowlisted).
  const integrationsApi = createIntegrationsApi({
    ...base,
    mailer,
    audit,
    ...deps.integrations,
  });
  mounts.push(integrationsApi);
  const auditApi = createAuditApi({ ...base });
  mounts.push(auditApi);
  // GIFs (T-0122): search, trending and the media proxy. Mounted always: an
  // unconfigured provider answers 501 `gifs_unavailable` instead of 404ing,
  // so the web can hide the tab.
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
  // Voice transcripts on demand (T-0170): the enabled flag plus the
  // transcript route for any signed-in user, and the owner-only endpoint
  // settings. Covered by the 401 sweep as session-required routes (never
  // allowlisted). Tests inject the audio fetcher and the transcriber so no
  // request ever reaches ejabberd or a real provider.
  const voiceTranscriptionApi = createVoiceTranscriptionApi({
    ...base,
    audit,
    ...deps.voiceTranscription,
  });
  mounts.push(voiceTranscriptionApi);
  // Provider-key connections always mount: with no envelope-encryption master
  // key configured, each route answers 503 (`connections_unavailable`) rather
  // than disappearing into a bare 404. The key is validated at startup by the
  // config schema when present. Tests override the cipher and probe so no
  // request ever reaches a real provider.
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
  // AIs always mount. Creating one needs the key cipher (to seal the provider
  // connection's key); when it is missing every write route answers 503
  // (`ais_unavailable`) rather than failing halfway.
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
