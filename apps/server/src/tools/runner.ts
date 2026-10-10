import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import {
  getToolRow,
  MAX_RUN_OUTPUT_BYTES,
  MAX_RUNS_PER_TOOL,
  toPublicRun,
  ToolServiceError,
  type RunRow,
  type VersionRow,
} from './queries';
import type { PublicToolRun, RunToolVersionDeps, RunToolVersionInput } from './service';
import type { ToolRunResult } from './types';

// Runs one version (default: current) through the injected runner port and
// records an `ai_tool_runs` row in the same step. The AI must be `active`
// (the kill switch): a stopped or provisioning AI throws
// `ai_not_active` before the runner is called. A runner failure is
// recorded as `error` with its kind and returned, never thrown.
//
// T-0132: the sandbox may only contact `declared hosts ∩ approved hosts`.
// `allowedHosts` passed to the runner is that intersection (already
// lowercased by `toolHostsSchema`), so a tool with no approved hosts still
// runs, with no network. This holds for every trigger (`manual`,
// `routine`, `ai`) because every run path goes through here.
export async function runToolVersion(
  deps: RunToolVersionDeps,
  input: RunToolVersionInput,
  now: Date,
): Promise<{ result: ToolRunResult; run: PublicToolRun }> {
  const tool = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, input.toolId);
    }),
  );
  if (!tool) {
    throw new ToolServiceError('not_found', 'Tool not found');
  }
  const wantVersion = input.version ?? tool.currentVersion;
  const versionRow = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${tool.id} AND version = ${wantVersion} LIMIT 1`;
      return row ?? null;
    }),
  );
  if (!versionRow) {
    throw new ToolServiceError('not_found', 'Tool version not found');
  }
  const ai = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<{ status: string }>`SELECT status FROM ais
        WHERE id = ${tool.aiId} LIMIT 1`;
      return row ?? null;
    }),
  );
  if (!ai || ai.status !== 'active') {
    throw new ToolServiceError('ai_not_active', 'The AI is not active');
  }
  const approved = new Set(tool.approvedHosts ?? []);
  const result = await deps.runner({
    source: versionRow.source,
    input: input.input ?? null,
    allowedHosts: versionRow.hosts.filter((host) => approved.has(host)),
  });
  const run = await recordRun(deps.db, {
    toolId: tool.id,
    version: versionRow.version,
    trigger: input.trigger,
    result,
    now,
  });
  return { result, run };
}

interface InsertVersionInput {
  toolId: string;
  version: number;
  source: string;
  hosts: string[];
  message: string;
  createdBy: string;
  now: Date;
}

interface RecordSaveAuditInput {
  action: 'tool.created' | 'tool.updated';
  toolId: string;
  actorUserId: string;
  aiId: string;
  groupId: string | null;
  version: number;
  name: string;
}

// Writes the `tool.created` / `tool.updated` audit entry: actor, AI and
// chat ids, subject = the tool id looked up by name, `detail { name,
// version }`. Never source, hosts or output. The recorder swallows its
// own failures, so this never throws into the save.
export async function recordSaveAudit(
  audit: AuditRecorder,
  input: RecordSaveAuditInput,
): Promise<void> {
  await audit.record({
    actorUserId: input.actorUserId,
    aiId: input.aiId,
    groupId: input.groupId,
    action: input.action,
    subjectId: input.toolId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: { name: input.name, version: input.version },
  });
}

export function insertVersion(
  sql: SqlClient.SqlClient,
  input: InsertVersionInput,
): Effect.Effect<VersionRow, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [row] = yield* sql<VersionRow>`INSERT INTO ai_tool_versions
        (id, tool_id, version, source, hosts, message, created_by, created_at)
      VALUES (
        ${randomUUID()},
        ${input.toolId},
        ${input.version},
        ${input.source},
        ${JSON.stringify(input.hosts)}::jsonb,
        ${input.message},
        ${input.createdBy},
        ${input.now.toISOString()}
      )
      RETURNING *`;
    if (!row) {
      return yield* Effect.die(new Error('Failed to insert tool version'));
    }
    return row;
  });
}

interface RecordRunInput {
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  result: ToolRunResult;
  now: Date;
}

// Inserts the run row and prunes older rows beyond the newest 50, in one
// transaction. Output text is truncated to 2 KiB (UTF-8 bytes).
function recordRun(db: ServerDatabase, input: RecordRunInput): Promise<PublicToolRun> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const outputText = input.result.ok ? input.result.output.text : null;
          const [row] = yield* sql<RunRow>`INSERT INTO ai_tool_runs
              (id, tool_id, version, trigger, status, error_kind, duration_ms,
                fetch_count, output_text, created_at)
            VALUES (
              ${randomUUID()},
              ${input.toolId},
              ${input.version},
              ${input.trigger},
              ${input.result.ok ? 'ok' : 'error'},
              ${input.result.ok ? null : input.result.error.kind},
              ${input.result.durationMs},
              ${input.result.fetchCount},
              ${truncateBytes(outputText, MAX_RUN_OUTPUT_BYTES)},
              ${input.now.toISOString()}
            )
            RETURNING *`;
          if (!row) {
            return yield* Effect.die(new Error('Failed to record tool run'));
          }
          const newest = yield* sql<{ id: string }>`SELECT id FROM ai_tool_runs
            WHERE tool_id = ${input.toolId}
            ORDER BY created_at DESC, id DESC
            LIMIT ${MAX_RUNS_PER_TOOL + 1}`;
          const keepIds = new Set(newest.slice(0, MAX_RUNS_PER_TOOL).map((kept) => kept.id));
          keepIds.add(row.id);
          const stale = newest.map((kept) => kept.id).filter((id) => !keepIds.has(id));
          if (stale.length > 0) {
            yield* sql`DELETE FROM ai_tool_runs
              WHERE tool_id = ${input.toolId} AND id IN ${sql.in(stale)}`;
          }
          return toPublicRun(row);
        }),
      );
    }),
  );
}

function truncateBytes(value: string | null, maxBytes: number): string | null {
  if (value === null) {
    return null;
  }
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }
  const buffer = Buffer.from(value, 'utf8').subarray(0, maxBytes);
  return buffer.toString('utf8');
}
