import type { ServerCore } from '../app/deps';
import { Layer, Effect } from 'effect';
import { HttpApiBuilder, HttpApi } from 'effect/http-api';
import {
  AisSchemaErrors,
  type PublicAi as WireAi,
  AisConfigured,
  AisGroup,
} from '@zilar/api-contract';
import { getAiCatalog } from '../ai/catalog';
import { type AuditRecorder } from '../audit/recorder';

import { createAi, updateAi } from './provisioning';
import { deleteAi } from './provisioning-xmpp';
import { emitAiLifecycle, findOwnedAi, getOwnedAi, listAis, toPublicAi } from './queries';
import { type AiLogger, type AiServiceDeps, type PublicAi } from './persona';

import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import { type KeyCipher } from '../connections/crypto';
import { type ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import {
  mountGroups,
  handler,
  schemaErrorLayerFor,
  type EffectApiMount,
  httpErrorResponse,
  requestIdOf,
  type SchemaErrorRender,
} from '../effect/http-core';
import { type TurnStopper } from '../agents/gateway/stop-types';
import { getAiUsage } from './usage';
import { type Logger } from 'pino';
import { HttpServerRequest } from 'effect/http';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
interface LastFailure {
  kind: string;
  at: string;
}

type WithLastFailure<T> = T & { lastFailure: LastFailure | null };

// A product choice: the log is kept 30 days, but 7 is what stays interesting.
const FAILURE_WINDOW = '7 days';

// `data->>'kind'` is text or null (a row written before the field existed).
interface LastFailureRow {
  aiId: string;
  kind: string | null;
  at: Date;
}

// `DISTINCT ON` keeps the newest error and `NOT EXISTS` drops one an answer has
// cleared. No ids means no query.
export async function lastFailures(
  db: ServerDatabase,
  aiIds: readonly string[],
): Promise<Map<string, LastFailure>> {
  if (aiIds.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<LastFailureRow>`SELECT DISTINCT ON (e.ai_id) e.ai_id, e.data->>'kind' AS kind, e.at
        FROM agent_task_events e
        WHERE e.ai_id IN ${sql.in(aiIds)} AND e.kind = ${'error'} AND e.at > now() - ${FAILURE_WINDOW}::interval
          AND NOT EXISTS (SELECT 1 FROM agent_task_events a
            WHERE a.ai_id = e.ai_id AND a.kind = ${'answer'} AND a.at > e.at)
        ORDER BY e.ai_id, e.at DESC`;
    }),
  );
  const failures = new Map<string, LastFailure>();
  for (const row of rows) {
    if (row.kind === null) {
      continue;
    }
    failures.set(row.aiId, { kind: row.kind, at: new Date(row.at).toISOString() });
  }
  return failures;
}

// One read for the whole list; any failure gives every AI `lastFailure: null`.
export async function withLastFailures<T extends { id: string }>(
  db: ServerDatabase,
  list: readonly T[],
): Promise<Array<WithLastFailure<T>>> {
  if (list.length === 0) {
    return [];
  }
  let failures: Map<string, LastFailure>;
  try {
    failures = await lastFailures(
      db,
      list.map((item) => item.id),
    );
  } catch {
    failures = new Map();
  }
  return list.map((item) => ({ ...item, lastFailure: failures.get(item.id) ?? null }));
}

const renderSchemaError: SchemaErrorRender = (error) =>
  Effect.succeed(
    new HttpError(400, 'invalid_request', error.cause.message || 'Invalid AI request'),
  );

// The 503 gate runs before the payload is decoded, so a malformed body on an
// unconfigured server answers 503, not 400.

function configuredLayer(deps: { cipher?: KeyCipher }): Layer.Layer<AisConfigured> {
  return Layer.succeed(
    AisConfigured,
    AisConfigured.of(
      Effect.fnUntraced(function* (httpEffect) {
        if (deps.cipher === undefined) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return httpErrorResponse(
            requestIdOf(request),
            new HttpError(503, 'ais_unavailable', 'AI management is not configured on this server'),
          );
        }
        return yield* httpEffect;
      }),
    ),
  );
}

const AisApi = HttpApi.make('ais').add(AisGroup);

interface StopTurnDeps extends Pick<ServerCore, 'db'> {
  getGateway: () => TurnStopper | null;
}

interface StopTurnInput {
  aiId: string;
  userId: string;
  chatJid: string;
}

async function stopTurn(deps: StopTurnDeps, input: StopTurnInput): Promise<{ stopped: boolean }> {
  const ai = await getOwnedAi(deps.db, input.aiId, input.userId);
  if (ai === null) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  const stopped = deps.getGateway()?.stopTurn(ai.id, input.chatJid) ?? false;
  return { stopped };
}

function toLogger(logger: AiLogger): Logger {
  return {
    error: (fields: Record<string, unknown>, message: string) => {
      logger.warn(fields, message);
    },
  } as unknown as Logger;
}

export interface AisApiDependencies extends Pick<
  ServerCore,
  'auth' | 'db' | 'config' | 'adminClient'
> {
  logger: AiLogger;
  /** Absent when the key cipher is not configured: those routes answer 503. */
  cipher?: KeyCipher;
  /** True when the desk agent is ready, so the picker can offer Zilar cloud. */
  cloud?: () => Promise<boolean>;
  /** A stop/resume that flipped the status writes one entry; idempotent
   * repeats and 4xx write nothing. */
  audit?: AuditRecorder;
  /** Read lazily: the app is built before the gateway exists. */
  getGateway?: () => TurnStopper | null;
}

// Null when the usage read fails or times out: the UI shows "unavailable" and
// turns fail open.
export interface AiUsageSummary {
  todayUsd: number;
  windowUsd: number;
}

export type PublicAiWithUsage = PublicAi & { usage: AiUsageSummary | null };

// Races the database sum so a slow read answers null instead of holding the list.
export const USAGE_TIMEOUT_MS = 2_000;

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
    // Unreachable through the mount (the gate answers 503 first); kept as a backstop.
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

  // One query for the whole list, never one per AI.
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

  // Spend is best-effort decoration here, never a reason to fail the route.
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
      // A buggy recorder must not break the route.
    }
  }

  const groupLayer = HttpApiBuilder.group(AisApi, 'ais', (handlers) =>
    handlers
      .handle(
        'list',
        handler(effectLogger, async (_request, user) => {
          const ais = await listAis(deps.db, user.id);
          const withAvatarList = await withAvatars(ais);
          const rows = await Promise.all(withAvatarList.map((ai) => withUsage(ai)));
          const decorated = await withLastFailures(deps.db, rows);
          return decorated.map(toWire);
        }),
      )
      .handle(
        'catalog',
        handler(effectLogger, () => getAiCatalog()),
      )
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
      // Stop/resume need only the database, so the kill switch works when the
      // cipher or the gateway is down. Audit only on a real status flip.
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
      // Audit only when the value changed, mirroring stop/resume.
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

  return mountGroups(AisApi, groupLayer, {
    auth: deps.auth,
    logger: effectLogger,
    schemaErrors: schemaErrorLayerFor(AisSchemaErrors, effectLogger, renderSchemaError),
    afterSchema: configuredLayer(cipher === undefined ? {} : { cipher }),
  });
}
// Owner-only and DB-only, so the kill switch works when the cipher or XMPP are
// down. A foreign id answers the same 404; idempotent on `stopped`; `disabled`
// answers 409 so a resume cannot flip a half-built AI. The conditional update
// loses to a racing delete or second stop.
async function stopAi(
  deps: Pick<AiServiceDeps, 'db'>,
  id: string,
  ownerId: string,
): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, id, ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (ai.status === 'stopped') {
    return toPublicAi(ai);
  }
  if (ai.status === 'disabled') {
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  const updated = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ais
        SET status = 'stopped', updated_at = ${new Date()}
        WHERE id = ${ai.id} AND status = 'active'
        RETURNING id`;
    }),
  );
  if (updated.length === 0) {
    // A concurrent stop/resume/delete raced the update: re-read under the owner's
    // view.
    const fresh = await findOwnedAi(deps.db, ai.id, ownerId);
    if (fresh === null) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    if (fresh.status === 'stopped') {
      return toPublicAi(fresh);
    }
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  emitAiLifecycle({ type: 'stopped', aiId: ai.id });
  const reloaded = await findOwnedAi(deps.db, ai.id, ownerId);
  if (reloaded === null) {
    // Deleted between the update and the read; the caller gets a 404.
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}

// Mirror of `stopAi`: accepts only `stopped`, idempotent on `active`, 409 on
// `disabled`. The conditional update makes a racing stop or delete win.
async function resumeAi(
  deps: Pick<AiServiceDeps, 'db'>,
  id: string,
  ownerId: string,
): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, id, ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (ai.status === 'active') {
    return toPublicAi(ai);
  }
  if (ai.status === 'disabled') {
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  const updated = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE ais
        SET status = 'active', updated_at = ${new Date()}
        WHERE id = ${ai.id} AND status = 'stopped'
        RETURNING id`;
    }),
  );
  if (updated.length === 0) {
    const fresh = await findOwnedAi(deps.db, ai.id, ownerId);
    if (fresh === null) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    if (fresh.status === 'active') {
      return toPublicAi(fresh);
    }
    throw new HttpError(409, 'not_active', 'AI is not active');
  }
  emitAiLifecycle({ type: 'resumed', aiId: ai.id });
  const reloaded = await findOwnedAi(deps.db, ai.id, ownerId);
  if (reloaded === null) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}

interface AssignMachineInput {
  aiId: string;
  ownerId: string;
  machineId: string | null;
}

// Owner-only. A machine that is missing, foreign or not `approved` answers the
// same 404, so the caller cannot tell which. The AI's own status does not
// matter: the home machine is only a pointer.
async function assignMachine(
  deps: Pick<AiServiceDeps, 'db'>,
  input: AssignMachineInput,
): Promise<PublicAi> {
  const ai = await findOwnedAi(deps.db, input.aiId, input.ownerId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  if (input.machineId === null) {
    if (ai.machineId === null) {
      return toPublicAi(ai);
    }
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ais SET machine_id = NULL, updated_at = ${new Date()} WHERE id = ${ai.id}`;
      }),
    );
  } else {
    const machineId = input.machineId;
    const [machine] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ status: string }>`SELECT status
          FROM machines
          WHERE id = ${machineId} AND owner_user_id = ${input.ownerId}
          LIMIT 1`;
      }),
    );
    if (!machine || machine.status !== 'approved') {
      throw new HttpError(404, 'machine_not_found', 'Machine not found');
    }
    if (ai.machineId === machineId) {
      return toPublicAi(ai);
    }
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE ais SET machine_id = ${machineId}, updated_at = ${new Date()} WHERE id = ${ai.id}`;
      }),
    );
  }
  const reloaded = await findOwnedAi(deps.db, ai.id, input.ownerId);
  if (reloaded === null) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }
  return toPublicAi(reloaded);
}
