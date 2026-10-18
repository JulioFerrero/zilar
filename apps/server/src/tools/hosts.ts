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

type HostsChange = 'approve' | 'revoke';

const CHANGE_TEXT: Record<HostsChange, string> = {
  approve: 'approving hosts',
  revoke: 'revoking hosts',
};

// The shared body of approve and revoke (T-0132): load the tool and its
// current version, replace `approved_hosts`, read the last run status and
// record the audit entry. The recorder swallows its own failures, so this
// never throws into the caller.
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

// Sets the tool's `approved_hosts` to exactly `hosts` (T-0132). Used by
// the `tool.approve_hosts` adapter after a human approved the card whose
// hosts were read from the current version. The audit detail carries ids
// and host names only, never code or output.
export async function approveToolHosts(
  db: ServerDatabase,
  input: { toolId: string; hosts: string[]; userId: string },
  now: Date,
  audit?: AuditRecorder,
): Promise<ToolDetail> {
  const hosts = Schema.decodeUnknownSync(toolHostsSchema)(input.hosts);
  return setToolHosts(db, input, hosts, now, audit, 'approve');
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
  return setToolHosts(db, input, [], now, audit, 'revoke');
}

export function hostsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((host, index) => host === b[index]);
}
