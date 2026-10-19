import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import type { AiToolRow, AiToolVersionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { getToolRow, latestRunStatus, toToolDetail, ToolServiceError } from './queries';
import { toolHostsSchema } from './schemas';
import type { ToolDetail } from './service';

type HostsChange = 'approve' | 'revoke';

const CHANGE_TEXT: Record<HostsChange, string> = {
  approve: 'approving hosts',
  revoke: 'revoking hosts',
};

// Loads the tool and current version, replaces `approved_hosts`, reads the last run status and audits; never throws.
async function setToolHosts(
  db: ServerDatabase,
  input: { toolId: string; userId: string },
  hosts: string[],
  now: Date,
  audit: AuditRecorder | undefined,
  kind: HostsChange,
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
      const [row] = yield* sql<AiToolVersionRow>`SELECT * FROM ai_tool_versions
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
      return yield* sql<AiToolRow>`UPDATE ai_tools
        SET approved_hosts = ${JSON.stringify(hosts)}::jsonb, updated_at = ${now.toISOString()}
        WHERE id = ${tool.id}
        RETURNING *`;
    }),
  );
  if (!updated) {
    throw new Error(`Tool disappeared while ${CHANGE_TEXT[kind]}`);
  }
  const lastRunStatus = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* latestRunStatus(sql, tool.id);
    }),
  );
  if (audit !== undefined) {
    const detail =
      kind === 'approve'
        ? { name: tool.name, version: current.version, hosts }
        : { name: tool.name };
    await audit.record({
      actorUserId: input.userId,
      aiId: tool.aiId,
      groupId: tool.groupId,
      action: kind === 'approve' ? 'tool.hosts_approved' : 'tool.hosts_revoked',
      subjectId: tool.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail,
    });
  }
  return toToolDetail(updated, current, lastRunStatus);
}

// Sets `approved_hosts` exactly; the audit carries ids and host names only, never code or output.
export async function approveToolHosts(
  db: ServerDatabase,
  input: { toolId: string; hosts: string[]; userId: string },
  now: Date,
  audit?: AuditRecorder,
): Promise<ToolDetail> {
  const hosts = Schema.decodeUnknownSync(toolHostsSchema)(input.hosts);
  return setToolHosts(db, input, hosts, now, audit, 'approve');
}

// Empties the set; the tool runs without network until a new approval. Audits `detail { name }` only.
export async function revokeToolHosts(
  db: ServerDatabase,
  input: { toolId: string; userId: string },
  now: Date,
  audit?: AuditRecorder,
): Promise<ToolDetail> {
  return setToolHosts(db, input, [], now, audit, 'revoke');
}

export function hostsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((host, index) => host === b[index]);
}
