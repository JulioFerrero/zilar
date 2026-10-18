import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

// Soft-deletes every active routine of one AI in one topic; returns the deleted ids.
export async function deleteRoutinesForAiInTopic(
  db: ServerDatabase,
  input: { aiId: string; topicId: string; now: Date },
): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE routines
        SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
        WHERE ai_id = ${input.aiId} AND topic_id = ${input.topicId} AND deleted_at IS NULL
        RETURNING id`;
    }),
  );
  return rows.map((row) => row.id);
}

// Soft-deletes every active routine of one AI in every topic of a group; returns the deleted ids.
export function deleteRoutinesForAiInGroupEffect(input: {
  aiId: string;
  groupId: string;
  now: Date;
}): Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: string }>`UPDATE routines
      SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
      WHERE ai_id = ${input.aiId} AND group_id = ${input.groupId} AND deleted_at IS NULL
      RETURNING id`;
    return rows.map((row) => row.id);
  });
}

// Soft-deletes every active routine running one tool; returns the deleted ids.
export async function deleteRoutinesForTool(
  db: ServerDatabase,
  input: { toolId: string; now: Date },
): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE routines
        SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
        WHERE tool_id = ${input.toolId} AND deleted_at IS NULL
        RETURNING id`;
    }),
  );
  return rows.map((row) => row.id);
}
