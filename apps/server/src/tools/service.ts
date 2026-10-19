import type { ServerDatabase } from '../db/client';
import type { AiToolRow, ToolIdentity } from '../db/rows';
import type { ToolRunner } from './types';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { runSql } from '../effect/sql';
import { deleteRoutinesForTool } from '../routines/deletes';

// Soft-deletes one tool and its routines; a missing or already deleted id returns `deleted: false` and writes nothing.
export async function deleteTool(
  db: ServerDatabase,
  toolId: string,
  now: Date,
): Promise<{ deleted: boolean }> {
  const [updated] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiToolRow>`UPDATE ai_tools
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

// Effect versions of the two bulk deletes, for a caller that already holds a `SqlClient`; returns the deleted ids.
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
export type { ToolRunner, ToolRunResult } from './types';

// Versioned tool code per AI and topic; history is append-only — nothing updates or deletes a version row.

export interface SaveToolVersionInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  name: string;
  description: string;
  source: string;
  hosts: string[];
  message: string;
  userId: string;
}

// No source; `hosts` and `lastRunStatus` come from the current version and newest run, `approvedHosts` from the human.
export interface PublicTool extends ToolIdentity {
  hosts: string[];
  // Hosts a human approved via `tool.approve_hosts` (default empty).
  approvedHosts: string[];
  lastRunStatus: 'ok' | 'error' | null;
  updatedAt: Date;
}

export interface ToolDetail extends PublicTool {
  source: string;
}

export interface PublicToolVersion {
  id: string;
  toolId: string;
  version: number;
  message: string;
  hosts: string[];
  createdBy: string;
  createdAt: Date;
}

export interface ToolVersionDetail extends PublicToolVersion {
  source: string;
}

export interface SaveToolVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  // True when source and hosts matched, so no new row was written.
  unchanged: boolean;
  // `created: true` when the tool row was inserted by this call.
  created: boolean;
}

export interface RevertToolInput {
  toolId: string;
  toVersion: number;
  userId: string;
  message?: string;
}

export interface RunToolVersionDeps {
  db: ServerDatabase;
  runner: ToolRunner;
}

export interface RunToolVersionInput {
  toolId: string;
  version?: number;
  input?: unknown;
  trigger: 'manual' | 'routine' | 'ai';
}

export {
  getTool,
  getVersion,
  listRuns,
  listTools,
  listToolsForAi,
  listVersions,
  MAX_RUN_OUTPUT_BYTES,
  MAX_RUNS_PER_TOOL,
  MAX_TOOLS_PER_TOPIC,
  MAX_VERSIONS_PER_TOOL,
  ToolServiceError,
} from './queries';

export { revertTool, saveToolVersion } from './mutations';
export { approveToolHosts, revokeToolHosts } from './hosts';
export { runToolVersion } from './runner';
