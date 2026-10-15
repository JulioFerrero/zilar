// AIs module on the Effect `HttpApi` adapter (T-0555): the same methods,
// paths, statuses (201 on create, 204 on delete, 503 gating), bodies, audit
// calls and step order as the deleted router (`routes.ts`), mounted by the
// Effect edge (`apps/server/src/effect/edge.ts`). Its service runs on effect/sql.

import { Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { AisSchemaErrors, type PublicAi as WireAi } from '@zilar/api-contract';
import { getAiCatalog } from '../ai/catalog';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerConfig } from '../config';
import type { KeyCipher } from '../connections/crypto';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  handler,
  mountApi,
  schemaErrorLayerFor,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { TurnStopper } from '../agents/gateway/stop-types';
import { AisApi, configuredLayer, renderSchemaError } from './api-layers';
import { toLogger } from './http-logger';
import { stopTurn } from './stop-turn';
import {
  assignMachine,
  createAi,
  deleteAi,
  getOwnedAi,
  listAis,
  resumeAi,
  stopAi,
  updateAi,
  type AiLogger,
  type PublicAi,
} from './service';
import { withLastFailures } from './health';
import { getAiUsage } from './usage';

export interface AisApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  config: ServerConfig;
  adminClient: EjabberdAdminClient;
  logger: AiLogger;
  /** Absent when the key cipher is not configured: routes that touch an AI
   * answer 503 instead of failing halfway. */
  cipher?: KeyCipher;
  /** T-1425/T-1603: true when the desk agent answers ready, so the Computer
   * picker can offer Zilar cloud. Defaults to a probe that answers false. */
  cloud?: () => Promise<boolean>;
  /** Audit recorder (T-0083): when present, a successful stop / resume that
   * actually flipped the AI's status writes one entry; an idempotent repeat
   * writes nothing; a 4xx writes nothing. The recorder swallows its own
   * errors, so the response is never affected. */
  audit?: AuditRecorder;
  /** T-1422: the live agent gateway's turn-stop hook, or null when the gateway
   * is disabled. Read lazily, because the app is built before the gateway. */
  getGateway?: () => TurnStopper | null;
}

// The spend summary the AI list and detail carry (T-0058). Null when the usage
// read fails or times out (T-1405: it now reads `ai_usage`): the UI shows
// "unavailable" and turns fail open.
export interface AiUsageSummary {
  todayUsd: number;
  windowUsd: number;
}

export type PublicAiWithUsage = PublicAi & { usage: AiUsageSummary | null };

// The usage read is a database sum, but it still races this timeout so a slow
// database answers `usage: null` rather than holding the whole list.
export const USAGE_TIMEOUT_MS = 2_000;

// The service rows carry `createdAt` as a `Date`; the wire carries its ISO
// string, which is what `JSON.stringify` wrote before the contract declared
// the view.
function toWire(ai: PublicAi | PublicAiWithUsage): WireAi {
  return { ...ai, createdAt: ai.createdAt.toISOString() };
}

export function createAisApi(deps: AisApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const effectLogger = toLogger(logger);
  const cipher = deps.cipher;
  const audit = deps.audit;
  const cloud = deps.cloud ?? (async () => false);

  const requireConfigured = (): { cipher: KeyCipher } => {
    // Unreachable when called through create/patch/remove: the AisConfigured
    // endpoint middleware already answered 503. Kept as a backstop so the
    // handler never runs half-configured.
    if (cipher === undefined) {
      throw new HttpError(503, 'ais_unavailable', 'AI management is not configured on this server');
    }
    return { cipher };
  };

  const serviceDeps = (configured: { cipher: KeyCipher }): Parameters<typeof createAi>[0] => ({
    db: deps.db,
    adminClient: deps.adminClient,
    cipher: configured.cipher,
    logger,
    domain: deps.config.xmpp.domain,
  });

  // T-0165: every AI response that already carries a name gets `avatarUrl`
  // when the AI has a picture (omitted when none, like today). One query
  // for the whole list, never one per AI.
  const withAvatars = async (list: PublicAi[]): Promise<PublicAi[]> => {
    if (list.length === 0) {
      return list;
    }
    const ids = await avatarIdsByOwner(
      deps.db,
      'ai',
      list.map((ai) => ai.id),
    );
    return list.map((ai) =>
      ids.get(ai.id) === undefined ? ai : { ...ai, avatarUrl: avatarUrlFor(ids.get(ai.id)!) },
    );
  };

  // Reads one AI's usage with a per-AI timeout. On any failure or timeout the
  // AI answers `usage: null`: spend is best-effort decoration on the
  // management API, never a reason to fail it.
  const withUsage = async (ai: PublicAi): Promise<PublicAiWithUsage> => {
    const usage = await Promise.race([
      getAiUsage({ db: deps.db }, ai.id).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), USAGE_TIMEOUT_MS)),
    ]);
    if (usage === null) {
      return { ...ai, usage: null };
    }
    return { ...ai, usage: { todayUsd: usage.todayUsd, windowUsd: usage.windowUsd } };
  };

  async function recordAudit(
    entry: Parameters<NonNullable<typeof audit>['record']>[0],
  ): Promise<void> {
    if (audit === undefined) {
      return;
    }
    try {
      await audit.record(entry);
    } catch {
      // The recorder contract says it must not throw, but a buggy one
      // must not break the AI route either.
    }
  }

  const groupLayer = HttpApiBuilder.group(AisApi, 'ais', (handlers) =>
    handlers
      .handle(
        'list',
        handler(effectLogger, async (_request, user) => {
          const ais = await listAis(deps.db, user.id);
          const withAvatarList = await withAvatars(ais);
          // Owner only, as today: every id here came from the owner's own listing.
          // The reads run in parallel so one slow AI never holds the whole list.
          const rows = await Promise.all(withAvatarList.map((ai) => withUsage(ai)));
          // T-1504: one failure read for the whole list, never one per AI.
          const decorated = await withLastFailures(deps.db, rows);
          return decorated.map(toWire);
        }),
      )
      // T-1395: read-only models.dev catalog; needs no configured gateway.
      .handle(
        'catalog',
        handler(effectLogger, () => getAiCatalog()),
      )
      // T-1425/T-1603: read-only, session-required; asks the desk agent whether
      // it is ready instead of guessing from env.
      .handle(
        'computerOptions',
        handler(effectLogger, async () => ({ cloud: await cloud() })),
      )
      .handle(
        'detail',
        handler(effectLogger, async (request, user) => {
          const ai = await getOwnedAi(deps.db, request.params.id, user.id);
          if (!ai) {
            throw new HttpError(404, 'not_found', 'AI not found');
          }
          const [withAvatar] = await withAvatars([ai]);
          const withUsageAi = await withUsage(withAvatar ?? ai);
          const [decorated] = await withLastFailures(deps.db, [withUsageAi]);
          return toWire(decorated ?? withUsageAi);
        }),
      )
      .handle(
        'create',
        handler(effectLogger, async (request, user) => {
          const configured = requireConfigured();
          const payload = request.payload;
          const created = await createAi(serviceDeps(configured), {
            ownerId: user.id,
            name: payload.name,
            template: payload.template,
            ...(payload.persona === undefined ? {} : { persona: payload.persona }),
            providerConnectionId: payload.providerConnectionId,
            model: payload.model,
            limits: payload.limits ?? { perDayUsd: null, perMonthUsd: null },
          });
          return toWire(created);
        }),
      )
      .handle(
        'patch',
        handler(effectLogger, async (request, user) => {
          const configured = requireConfigured();
          const payload = request.payload;
          const updated = await updateAi(serviceDeps(configured), {
            id: request.params.id,
            ownerId: user.id,
            ...(payload.name === undefined ? {} : { name: payload.name }),
            ...(payload.persona === undefined ? {} : { persona: payload.persona }),
            ...(payload.limits === undefined ? {} : { limits: payload.limits }),
            ...(payload.model === undefined ? {} : { model: payload.model }),
            ...(payload.providerConnectionId === undefined
              ? {}
              : { providerConnectionId: payload.providerConnectionId }),
            ...(payload.canDelegate === undefined ? {} : { canDelegate: payload.canDelegate }),
            ...(payload.acceptsDelegation === undefined
              ? {}
              : { acceptsDelegation: payload.acceptsDelegation }),
            ...(payload.computerMode === undefined ? {} : { computerMode: payload.computerMode }),
          });
          return toWire(updated);
        }),
      )
      .handle(
        'remove',
        handler(effectLogger, (request, user) => {
          const configured = requireConfigured();
          return deleteAi(serviceDeps(configured), request.params.id, user.id);
        }),
      )
      // T-0080: the owner's kill switch. Stop disconnects the AI at once and
      // prevents the gateway from waking it back up; resume reconnects it. Both
      // answer the public AI, so the panel can re-render against the server
      // truth without a second GET. Unlike the other writes they need only the
      // database: a kill switch must work when the cipher or the gateway are
      // not configured or are down.
      //
      // T-0083: when an `audit` recorder is wired in, a real status flip writes
      // one entry (`ai.stopped` / `ai.resumed`); an idempotent repeat writes
      // nothing. The pre-read here is owner-checked, so a stranger gets the same
      // 404 whether or not the recorder is present, and we use it only to know
      // whether the service call actually changed the state. The service stays
      // free of audit code. The `try/catch` around `audit.record` is a defensive
      // backstop: the standard recorder swallows its own errors, but a custom or
      // buggy one must never turn a 200 into a 500 here.
      .handle(
        'stop',
        handler(effectLogger, async (request, user) => {
          const id = request.params.id;
          const before = await getOwnedAi(deps.db, id, user.id);
          const ai = await stopAi({ db: deps.db }, id, user.id);
          if (before !== null && before.status !== ai.status) {
            await recordAudit({
              actorUserId: user.id,
              aiId: ai.id,
              groupId: null,
              action: 'ai.stopped',
              subjectId: ai.id,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
          }
          return toWire(ai);
        }),
      )
      .handle(
        'resume',
        handler(effectLogger, async (request, user) => {
          const id = request.params.id;
          const before = await getOwnedAi(deps.db, id, user.id);
          const ai = await resumeAi({ db: deps.db }, id, user.id);
          if (before !== null && before.status !== ai.status) {
            await recordAudit({
              actorUserId: user.id,
              aiId: ai.id,
              groupId: null,
              action: 'ai.resumed',
              subjectId: ai.id,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: null,
            });
          }
          return toWire(ai);
        }),
      )
      // T-1422: stop the turn running in one chat. Owner only; answers
      // `{ stopped }`, false when no turn was running or the gateway is off.
      .handle(
        'stopTurn',
        handler(effectLogger, (request, user) =>
          stopTurn(
            {
              db: deps.db,
              getGateway: deps.getGateway ?? (() => null),
            },
            { aiId: request.params.id, userId: user.id, chatJid: request.payload.chatJid },
          ),
        ),
      )
      // T-0091: assign or clear the AI's home machine. The audit entry is
      // written only when the value actually changed, mirroring how `stop` /
      // `resume` skip the audit on an idempotent call: a recorder that swallows
      // errors must not turn a 200 into a 500 here either. The `try/catch`
      // around `audit.record` is the same defensive backstop as the kill-switch
      // routes. `before.machineId` and `ai.machineId` are always either the
      // same string or one of them is `null`, so the inequality check is
      // straightforward.
      .handle(
        'assignMachine',
        handler(effectLogger, async (request, user) => {
          const id = request.params.id;
          const machineId = request.payload.machineId;
          const before = await getOwnedAi(deps.db, id, user.id);
          const ai = await assignMachine(
            { db: deps.db },
            {
              aiId: id,
              ownerId: user.id,
              machineId,
            },
          );
          if (before !== null && before.machineId !== ai.machineId) {
            await recordAudit({
              actorUserId: user.id,
              aiId: ai.id,
              groupId: null,
              action: 'ai.machine_assigned',
              subjectId: ai.id,
              argsHash: null,
              costCurrency: null,
              costAmount: null,
              result: 'ok',
              detail: { machineId: ai.machineId },
            });
          }
          return toWire(ai);
        }),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(AisApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, effectLogger)),
    Layer.provide(schemaErrorLayerFor(AisSchemaErrors, effectLogger, renderSchemaError)),
    Layer.provide(configuredLayer(cipher === undefined ? {} : { cipher })),
  );

  return mountApi(AisApi, apiLayer);
}
