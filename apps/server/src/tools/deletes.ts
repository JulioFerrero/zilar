import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { deleteRoutinesForTool } from '../routines/service';
import type { ToolRow } from './queries';

// Soft-deletes one tool by id, and soft-deletes the tool's routines with
// it (T-0104). Idempotent: a missing id or an already deleted tool
// returns `deleted: false` and writes nothing.
export async function deleteTool(
  db: ServerDatabase,
  toolId: string,
  now: Date,
): Promise<{ deleted: boolean }> {
  const [updated] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`UPDATE ai_tools
        SET deleted_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
        WHERE id = ${toolId} AND deleted_at IS NULL
        RETURNING *`;
    }),
  );
  if (updated === undefined) {
    return { deleted: false };
  }
  await deleteRoutinesForTool(db, { toolId, now });
  return { deleted: true };
}

// Effect versions of the two deletes (T-0664): one AI's tools in one topic,
// and one AI's tools in every topic of a group. A caller that already holds a
// `SqlClient` runs them directly. Returns the deleted ids.
export function deleteToolsForAiInTopicEffect(input: {
  aiId: string;
  topicId: string;
  now: Date;
}): Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: string }>`UPDATE ai_tools
      SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
      WHERE ai_id = ${input.aiId} AND topic_id = ${input.topicId} AND deleted_at IS NULL
      RETURNING id`;
    return rows.map((row) => row.id);
  });
}

export function deleteToolsForAiInGroupEffect(input: {
  aiId: string;
  groupId: string;
  now: Date;
}): Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: string }>`UPDATE ai_tools
      SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
      WHERE ai_id = ${input.aiId} AND group_id = ${input.groupId} AND deleted_at IS NULL
      RETURNING id`;
    return rows.map((row) => row.id);
  });
}
