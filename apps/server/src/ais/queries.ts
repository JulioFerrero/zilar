import { Effect } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { PublicAi } from './persona';
import type { AiTemplate } from './templates';

export async function listAis(db: ServerDatabase, ownerId: string): Promise<PublicAi[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PublicAiRow>`SELECT
        ais.id,
        ais.name,
        ais.template,
        ais.persona,
        ais.model,
        ais.jid,
        ais.status,
        ais.provider_connection_id,
        ais.machine_id,
        ais.created_at,
        ai_limits.per_day_usd,
        ai_limits.per_month_usd,
        ais.can_delegate,
        ais.accepts_delegation
      FROM ais
      INNER JOIN ai_limits ON ai_limits.ai_id = ais.id
      WHERE ais.owner = ${ownerId}
      ORDER BY ais.created_at ASC`;
    }),
  );
  return rows.map(toPublicAi);
}

// Every active AI, for the agent gateway (T-0034). The gateway resolves the
// AI id itself from this listing and never from message content.
export interface ActiveAiForGateway {
  id: string;
  jid: string;
  localpart: string;
  owner: string;
  name: string;
  persona: string;
}

export async function listActiveAisForGateway(db: ServerDatabase): Promise<ActiveAiForGateway[]> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<ActiveAiForGateway>`SELECT
        ais.id,
        ais.jid,
        ais.localpart,
        ais.owner,
        ais.name,
        ais.persona
      FROM ais
      WHERE ais.status = ${'active'}
      ORDER BY ais.created_at ASC`;
      return [...rows];
    }),
  );
}

// In-process notifier so the gateway learns about created, deleted,
// stopped and resumed AIs without polling. The gateway also reconciles
// periodically as a safety net, so a missed event only delays a connect,
// never loses it. T-0080 added `stopped`/`resumed` for the owner kill switch:
// `stopped` disconnects the AI at once; `resumed` reconnects it.
export type AiLifecycleEvent = {
  type: 'created' | 'deleted' | 'stopped' | 'resumed';
  aiId: string;
};

const aiLifecycleListeners = new Set<(event: AiLifecycleEvent) => void>();

export function onAiLifecycle(listener: (event: AiLifecycleEvent) => void): () => void {
  aiLifecycleListeners.add(listener);
  return () => {
    aiLifecycleListeners.delete(listener);
  };
}

export function emitAiLifecycle(event: AiLifecycleEvent): void {
  // Deleting from a Set while iterating it is safe: a listener that
  // unsubscribes mid-emit is simply not visited again.
  for (const listener of aiLifecycleListeners) {
    try {
      listener(event);
    } catch {
      // A gateway listener must never break AI management.
    }
  }
}

// One AI owned by `ownerId`, or null for a missing id and a foreign one alike,
// so existence is never leaked. The internal shape carries the gateway key id
// and identity the public shape deliberately omits.
export async function findOwnedAi(
  db: ServerDatabase,
  id: string,
  ownerId: string,
): Promise<AiRecord | null> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<AiRecord>`SELECT
        ais.id,
        ais.name,
        ais.template,
        ais.persona,
        ais.model,
        ais.jid,
        ais.status,
        ais.provider_connection_id,
        ais.machine_id,
        ais.created_at,
        ai_limits.per_day_usd,
        ai_limits.per_month_usd,
        ais.can_delegate,
        ais.accepts_delegation,
        ais.localpart,
        llm_virtual_keys.litellm_key_id,
        llm_virtual_keys.litellm_model_id
      FROM ais
      INNER JOIN ai_limits ON ai_limits.ai_id = ais.id
      LEFT JOIN llm_virtual_keys ON llm_virtual_keys.ai_id = ais.id
      WHERE ais.id = ${id} AND ais.owner = ${ownerId}
      LIMIT 1`;
      return row ?? null;
    }),
  );
}

// One AI by id, with its connection's provider, for the gateway-only paths
// (`ensureAiModel`) that have no owner in hand. Not exported: no route may use
// it.
export async function findAiForGateway(
  db: ServerDatabase,
  aiId: string,
): Promise<GatewayAiRecord | null> {
  return runSql(db, findGatewayAiEffect(aiId));
}

// The public form of one owned AI, shaped for the API and the wizard.
export async function getOwnedAi(
  db: ServerDatabase,
  id: string,
  ownerId: string,
): Promise<PublicAi | null> {
  const row = await findOwnedAi(db, id, ownerId);
  return row ? toPublicAi(row) : null;
}

// Reads one AI with its connection's provider through `effect/sql`. The
// gateway-only paths share it so the row is always fresh under the lock. It is
// one statement, so a caller inside `sql.withTransaction` reads on the
// transaction's connection.
//
// Columns are listed explicitly and camelCased by `transformResultNames`, so
// the row matches `GatewayAiRecord`; both `ai_limits` and `llm_virtual_keys`
// carry an `ai_id`, which is why none is selected unaliased.
export function findGatewayAiEffect(
  aiId: string,
): Effect.Effect<GatewayAiRecord | null, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<GatewayAiRecord>`SELECT
      ais.id,
      ais.name,
      ais.template,
      ais.persona,
      ais.model,
      ais.jid,
      ais.status,
      ais.provider_connection_id,
      ais.machine_id,
      ais.created_at,
      ais.can_delegate,
      ais.accepts_delegation,
      ais.localpart,
      ais.owner,
      ai_limits.per_day_usd,
      ai_limits.per_month_usd,
      llm_virtual_keys.litellm_key_id,
      llm_virtual_keys.litellm_model_id,
      provider_connections.provider
    FROM ais
    INNER JOIN ai_limits ON ai_limits.ai_id = ais.id
    LEFT JOIN llm_virtual_keys ON llm_virtual_keys.ai_id = ais.id
    INNER JOIN provider_connections ON provider_connections.id = ais.provider_connection_id
    WHERE ais.id = ${aiId}
    LIMIT 1`;
    return row ?? null;
  });
}

// The internal row: the public columns plus the identity and gateway handles
// the routes must never answer with.
interface AiRecord {
  id: string;
  name: string;
  template: AiTemplate;
  persona: string;
  model: string;
  jid: string;
  localpart: string;
  status: 'active' | 'disabled' | 'stopped';
  providerConnectionId: string;
  machineId: string | null;
  createdAt: Date;
  perDayUsd: string;
  perMonthUsd: string;
  canDelegate: boolean;
  acceptsDelegation: boolean;
  litellmKeyId: string | null;
  litellmModelId: string | null;
}

// The AI row plus its connection's provider, for the gateway-only paths that
// need to build the provider-qualified model name.
interface GatewayAiRecord extends AiRecord {
  provider: string;
  owner: string;
}

type PublicAiRow = Omit<AiRecord, 'localpart' | 'litellmKeyId' | 'litellmModelId'>;

export function toPublicAi(row: PublicAiRow): PublicAi {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    persona: row.persona,
    model: row.model,
    jid: row.jid,
    status: row.status,
    providerConnectionId: row.providerConnectionId,
    limits: {
      perDayUsd: Number(row.perDayUsd),
      perMonthUsd: Number(row.perMonthUsd),
    },
    machineId: row.machineId,
    createdAt: row.createdAt,
    canDelegate: row.canDelegate,
    acceptsDelegation: row.acceptsDelegation,
  };
}
