// T-0984: size split of `routines/service.ts`. The routine reads, the row to
// view mapping and the per-topic limit check live here; the old path stays
// the barrel.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { parseRoutineSchedule, type RoutineSchedule } from './schedule';
import {
  MAX_ROUTINES_PER_TOPIC,
  RoutineServiceError,
  type PublicRoutine,
  type RoutineToolNameRow,
} from './schemas';

// One non-deleted routine, or null for a missing/deleted id.
export async function getRoutine(
  db: ServerDatabase,
  id: string,
): Promise<{ routine: RoutineRow; toolName: string } | null> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
      return found ?? null;
    }),
  );
  if (!row || row.deletedAt !== null) {
    return null;
  }
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineToolNameRow>`SELECT name FROM ai_tools
        WHERE id = ${row.toolId} LIMIT 1`;
      return found ?? null;
    }),
  );
  const schedule = parseRoutineSchedule(row.schedule);
  if (!schedule.ok) {
    return null;
  }
  return { routine: row, toolName: tool?.name ?? '' };
}

// Every non-deleted routine of one AI, newest first, with the tool name.
export async function listRoutinesForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<PublicRoutine[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE ai_id = ${aiId}`;
    }),
  );
  return toPublicRoutines(db, rows);
}

// Every non-deleted routine in one topic.
export async function listRoutinesForTopic(
  db: ServerDatabase,
  topicId: string,
): Promise<PublicRoutine[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE topic_id = ${topicId}`;
    }),
  );
  return toPublicRoutines(db, rows);
}

export async function enforceRoutineLimit(
  db: ServerDatabase,
  aiId: string,
  topicId: string | null,
): Promise<void> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const topic = topicId === null ? sql`topic_id IS NULL` : sql`topic_id = ${topicId}`;
      const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM routines WHERE ai_id = ${aiId} AND ${topic} AND deleted_at IS NULL`;
      return counter ?? null;
    }),
  );
  if (Number(row?.total ?? 0) >= MAX_ROUTINES_PER_TOPIC) {
    throw new RoutineServiceError(
      'routine_limit',
      `A topic has at most ${MAX_ROUTINES_PER_TOPIC} routines`,
    );
  }
}

export async function toPublicRoutines(
  db: ServerDatabase,
  rows: readonly RoutineRow[],
): Promise<PublicRoutine[]> {
  const live = rows.filter((row) => row.deletedAt === null);
  const result: PublicRoutine[] = [];
  for (const row of live) {
    const schedule = parseRoutineSchedule(row.schedule);
    if (!schedule.ok) {
      continue;
    }
    const tool = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [found] = yield* sql<RoutineToolNameRow>`SELECT name FROM ai_tools
          WHERE id = ${row.toolId} LIMIT 1`;
        return found ?? null;
      }),
    );
    result.push(toPublicRoutine(row, tool?.name ?? '', schedule.value));
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

export function toPublicRoutine(
  row: RoutineRow,
  toolName: string,
  schedule: RoutineSchedule,
): PublicRoutine {
  return {
    id: row.id,
    aiId: row.aiId,
    groupId: row.groupId,
    topicId: row.topicId,
    toolId: row.toolId,
    toolName,
    title: row.title,
    schedule,
    status: row.status,
    pausedReason: row.pausedReason,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    approvedHosts: [...row.approvedHosts],
    scope: row.groupId === null ? 'personal' : 'group',
  };
}
