import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import {
  getToolRow,
  latestRunStatus,
  toToolDetail,
  ToolServiceError,
  type ToolRow,
  type VersionRow,
} from './queries';
import { toolHostsSchema } from './schemas';
import type { ToolDetail } from './service';

// Sets the tool's `approved_hosts` to exactly `hosts` (T-0132). Used by
// the `tool.approve_hosts` adapter after a human approved the card whose
// hosts were read from the current version. Audits `tool.hosts_approved`
// with `detail { name, version, hosts }`: ids and host names are fine,
// never code or output. The recorder swallows its own failures, so this
// never throws into the caller.
export async function approveToolHosts(
  db: ServerDatabase,
  input: { toolId: string; hosts: string[]; userId: string },
  now: Date,
  audit?: AuditRecorder,
): Promise<ToolDetail> {
  const hosts = Schema.decodeUnknownSync(toolHostsSchema)(input.hosts);
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, input.toolId);
    }),
  );
  if (!tool) {
    throw new ToolServiceError('not_found', 'Tool not found');
  }
  const current = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${tool.id} AND version = ${tool.currentVersion} LIMIT 1`;
      return row ?? null;
    }),
  );
  if (!current) {
    throw new ToolServiceError('not_found', 'Tool version not found');
  }
  const [updated] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`UPDATE ai_tools
        SET approved_hosts = ${JSON.stringify(hosts)}::jsonb, updated_at = ${now.toISOString()}
        WHERE id = ${tool.id}
        RETURNING *`;
    }),
  );
  if (!updated) {
    throw new Error('Tool disappeared while approving hosts');
  }
  const lastRunStatus = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* latestRunStatus(sql, tool.id);
    }),
  );
  if (audit !== undefined) {
    await audit.record({
      actorUserId: input.userId,
      aiId: tool.aiId,
      groupId: tool.groupId,
      action: 'tool.hosts_approved',
      subjectId: tool.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { name: tool.name, version: current.version, hosts },
    });
  }
  return toToolDetail(updated, current, lastRunStatus);
}

// Empties the tool's `approved_hosts` (T-0132 `tool.revoke_hosts`): the
// tool keeps running with no network until a new approval. Audits
// `tool.hosts_revoked` with `detail { name }` only.
export async function revokeToolHosts(
  db: ServerDatabase,
  input: { toolId: string; userId: string },
  now: Date,
  audit?: AuditRecorder,
): Promise<ToolDetail> {
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, input.toolId);
    }),
  );
  if (!tool) {
    throw new ToolServiceError('not_found', 'Tool not found');
  }
  const current = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${tool.id} AND version = ${tool.currentVersion} LIMIT 1`;
      return row ?? null;
    }),
  );
  if (!current) {
    throw new ToolServiceError('not_found', 'Tool version not found');
  }
  const [updated] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`UPDATE ai_tools
        SET approved_hosts = ${JSON.stringify([])}::jsonb, updated_at = ${now.toISOString()}
        WHERE id = ${tool.id}
        RETURNING *`;
    }),
  );
  if (!updated) {
    throw new Error('Tool disappeared while revoking hosts');
  }
  const lastRunStatus = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* latestRunStatus(sql, tool.id);
    }),
  );
  if (audit !== undefined) {
    await audit.record({
      actorUserId: input.userId,
      aiId: tool.aiId,
      groupId: tool.groupId,
      action: 'tool.hosts_revoked',
      subjectId: tool.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { name: tool.name },
    });
  }
  return toToolDetail(updated, current, lastRunStatus);
}

export function hostsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((host, index) => host === b[index]);
}
