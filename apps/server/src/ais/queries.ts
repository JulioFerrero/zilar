import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AiComputerMode } from '@zilar/api-contract';
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
        ais.computer_mode,
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

// The gateway resolves the AI id from this listing, never from message content.
export interface ActiveAiForGateway {
  id: string;
  jid: string;
  localpart: string;
  owner: string;
  name: string;
  persona: string;
  // Desk tools are offered only when the mode enables them; `runner`/`auto`
  // resolve through `machineId`.
  computerMode: AiComputerMode;
  machineId: string | null;
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
        ais.persona,
        ais.computer_mode,
        ais.machine_id
      FROM ais
      WHERE ais.status = ${'active'}
      ORDER BY ais.created_at ASC`;
      return [...rows];
    }),
  );
}

// In-process notifier so the gateway learns about lifecycle changes without
// polling; its periodic reconcile is the safety net for a missed event.
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
  // Deleting from a Set while iterating is safe: an unsubscribed listener is
  // simply not visited again.
  for (const listener of aiLifecycleListeners) {
    try {
      listener(event);
    } catch {
      // A gateway listener must never break AI management.
    }
  }
}

// A missing id and a foreign one both answer null, so existence is never leaked.
// The internal shape carries the localpart the public one omits.
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
        ais.computer_mode,
        ais.created_at,
        ai_limits.per_day_usd,
        ai_limits.per_month_usd,
        ais.can_delegate,
        ais.accepts_delegation,
        ais.localpart
      FROM ais
      INNER JOIN ai_limits ON ai_limits.ai_id = ais.id
      WHERE ais.id = ${id} AND ais.owner = ${ownerId}
      LIMIT 1`;
      return row ?? null;
    }),
  );
}

export async function getOwnedAi(
  db: ServerDatabase,
  id: string,
  ownerId: string,
): Promise<PublicAi | null> {
  const row = await findOwnedAi(db, id, ownerId);
  return row ? toPublicAi(row) : null;
}

// The public columns plus the identity routes must never answer with.
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
  computerMode: AiComputerMode;
  createdAt: Date;
  perDayUsd: string | null;
  perMonthUsd: string | null;
  canDelegate: boolean;
  acceptsDelegation: boolean;
}

type PublicAiRow = Omit<AiRecord, 'localpart'>;

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
      perDayUsd: row.perDayUsd === null ? null : Number(row.perDayUsd),
      perMonthUsd: row.perMonthUsd === null ? null : Number(row.perMonthUsd),
    },
    machineId: row.machineId,
    computerMode: row.computerMode,
    createdAt: row.createdAt,
    canDelegate: row.canDelegate,
    acceptsDelegation: row.acceptsDelegation,
  };
}
