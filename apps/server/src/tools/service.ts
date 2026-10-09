import { randomUUID } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { aiToolRuns, aiToolVersions, aiTools } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import { deleteRoutinesForTool } from '../routines/service';
import { parseToolVersionInput, toolHostsSchema } from './schemas';
import type { ToolRunner, ToolRunResult } from './types';

export type { ToolRunner, ToolRunResult };

// T-0103: versioned tool code per AI and topic. A tool belongs to one AI
// and one topic (`groupId` + `topicId`, or both null for the personal chat
// with the owner). History is append-only: `saveToolVersion` and
// `revertTool` only insert into `ai_tool_versions`; no function here ever
// updates or deletes a version row.

// Caps: at most 20 active tools per (AI, topic), at most 200 versions per
// tool. The runner output stored on a run row is truncated to 2 KiB, and
// only the newest 50 runs per tool are kept.
export const MAX_TOOLS_PER_TOPIC = 20;
export const MAX_VERSIONS_PER_TOOL = 200;
export const MAX_RUNS_PER_TOOL = 50;
export const MAX_RUN_OUTPUT_BYTES = 2 * 1024;

export class ToolServiceError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'ToolServiceError';
    this.errorCode = errorCode;
  }
}

type ToolRow = typeof aiTools.$inferSelect;
type VersionRow = typeof aiToolVersions.$inferSelect;
type RunRow = typeof aiToolRuns.$inferSelect;

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

// One tool as the list returns it: no source. `hosts` and `lastRunStatus`
// come from the current version and the newest run row. `approvedHosts`
// is the human-approved set (T-0132): the sandbox may only contact the
// intersection of declared `hosts` and this set.
export interface PublicTool {
  id: string;
  aiId: string;
  groupId: string | null;
  /** The topic the tool belongs to. Null for personal-chat tools. */
  topicId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  hosts: string[];
  /** Hosts a human approved via `tool.approve_hosts` (default empty). */
  approvedHosts: string[];
  lastRunStatus: 'ok' | 'error' | null;
  updatedAt: Date;
}

// One tool with its current source, as `getTool` returns it.
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

export interface PublicToolRun {
  id: string;
  toolId: string;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  status: 'ok' | 'error';
  errorKind: string | null;
  durationMs: number;
  fetchCount: number;
  outputText: string | null;
  createdAt: Date;
}

export interface SaveToolVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  /** True when source and hosts matched the current version, so no new row
   *  was written. */
  unchanged: boolean;
  /** `created: true` when the tool row was inserted by this call. */
  created: boolean;
}

interface AppendVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  /** True when source and hosts matched the current version, so no new row
   *  was written. */
  unchanged: boolean;
}

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// Creates the tool with version 1 when the name is new in that topic, or
// appends version N+1 when source or hosts differ from the current
// version. An identical save returns the current version with
// `unchanged: true` and writes nothing. All in one transaction; the tool
// row is locked (`SELECT … FOR UPDATE`) so two concurrent saves end with
// consecutive version numbers and no duplicate.
//
// `audit` is optional: when present, a `tool.created` or `tool.updated`
// entry is written after the transaction commits, with `detail { name,
// version }` and never any source. (No route in this task creates or
// updates tools — T-0104's AI-facing tools will pass the recorder.)
// The audit write never throws into the caller.
export async function saveToolVersion(
  db: ServerDatabase,
  input: SaveToolVersionInput,
  now: Date,
  audit?: AuditRecorder,
): Promise<SaveToolVersionResult> {
  const parsed = parseToolVersionInput({
    name: input.name,
    description: input.description,
    source: input.source,
    hosts: input.hosts,
    message: input.message,
  });
  if (!parsed.ok) {
    throw new ToolServiceError('invalid_request', parsed.message);
  }
  const { name, description, source, hosts, message } = parsed.value;

  const existing = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* findActiveTool(sql, input.aiId, input.topicId, name);
    }),
  );
  if (!existing) {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* enforceToolLimit(sql, input.aiId, input.topicId);
      }),
    );
    const createdResult = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const [inserted] = yield* sql<ToolRow>`INSERT INTO ai_tools
                (id, ai_id, group_id, topic_id, name, description, current_version,
                  created_by, created_at, updated_at)
              VALUES (
                ${randomUUID()},
                ${input.aiId},
                ${input.groupId},
                ${input.topicId},
                ${name},
                ${description},
                1,
                ${input.userId},
                ${now.toISOString()},
                ${now.toISOString()}
              )
              ON CONFLICT DO NOTHING
              RETURNING *`;
            if (inserted !== undefined) {
              const version = yield* insertVersion(sql, {
                toolId: inserted.id,
                version: 1,
                source,
                hosts,
                message,
                createdBy: input.userId,
                now,
              });
              return {
                tool: toToolDetail(inserted, version, null),
                version: toVersionDetail(version),
                unchanged: false,
                created: true,
              };
            }
            // Lost the race with a concurrent create of the same name: append
            // to the winner's history instead. The `ON CONFLICT DO NOTHING`
            // never aborts the transaction, so this read is safe here.
            const winner = yield* findActiveTool(sql, input.aiId, input.topicId, name);
            if (!winner) {
              return yield* Effect.die(new Error('Failed to create tool'));
            }
            return {
              ...(yield* appendVersion(sql, {
                tool: winner,
                description,
                source,
                hosts,
                message,
                userId: input.userId,
                now,
              })),
              created: false,
            };
          }),
        );
      }),
    );
    if (audit !== undefined && !createdResult.unchanged) {
      await recordSaveAudit(audit, {
        action: createdResult.created ? 'tool.created' : 'tool.updated',
        toolId: createdResult.tool.id,
        actorUserId: input.userId,
        aiId: input.aiId,
        groupId: input.groupId,
        version: createdResult.version.version,
        name,
      });
    }
    return createdResult;
  }
  const updatedResult = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [locked] = yield* sql<ToolRow>`SELECT * FROM ai_tools
            WHERE id = ${existing.id} LIMIT 1 FOR UPDATE`;
          if (!locked || locked.deletedAt !== null) {
            return yield* Effect.fail(new ToolServiceError('not_found', 'Tool not found'));
          }
          return {
            ...(yield* appendVersion(sql, {
              tool: locked,
              description,
              source,
              hosts,
              message,
              userId: input.userId,
              now,
            })),
            created: false,
          };
        }),
      );
    }),
  );
  if (audit !== undefined && !updatedResult.unchanged) {
    await recordSaveAudit(audit, {
      action: 'tool.updated',
      toolId: updatedResult.tool.id,
      actorUserId: input.userId,
      aiId: input.aiId,
      groupId: input.groupId,
      version: updatedResult.version.version,
      name,
    });
  }
  return updatedResult;
}

interface AppendVersionInput {
  tool: ToolRow;
  description: string;
  source: string;
  hosts: string[];
  message: string;
  userId: string;
  now: Date;
}

// Appends version N+1 inside the caller's transaction, or returns the
// current version unchanged when source and hosts both match. The lock on
// the tool row (taken by the caller) serialises concurrent appends.
function appendVersion(
  sql: SqlClient.SqlClient,
  input: AppendVersionInput,
): Effect.Effect<AppendVersionResult, SqlError.SqlError | ToolServiceError> {
  return Effect.gen(function* () {
    const [current] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
      WHERE tool_id = ${input.tool.id} AND version = ${input.tool.currentVersion}
      LIMIT 1`;
    if (!current) {
      return yield* Effect.die(new Error('Tool is missing its current version'));
    }
    if (current.source === input.source && hostsEqual(current.hosts, input.hosts)) {
      const lastRunStatus = yield* latestRunStatus(sql, input.tool.id);
      return {
        tool: toToolDetail(input.tool, current, lastRunStatus),
        version: toVersionDetail(current),
        unchanged: true,
      };
    }
    if (input.tool.currentVersion >= MAX_VERSIONS_PER_TOOL) {
      return yield* Effect.fail(
        new ToolServiceError(
          'version_limit',
          `A tool has at most ${MAX_VERSIONS_PER_TOOL} versions`,
        ),
      );
    }
    const next = input.tool.currentVersion + 1;
    const version = yield* insertVersion(sql, {
      toolId: input.tool.id,
      version: next,
      source: input.source,
      hosts: input.hosts,
      message: input.message,
      createdBy: input.userId,
      now: input.now,
    });
    const [updated] = yield* sql<ToolRow>`UPDATE ai_tools
      SET description = ${input.description}, current_version = ${next}, updated_at = ${input.now.toISOString()}
      WHERE id = ${input.tool.id}
      RETURNING *`;
    if (!updated) {
      return yield* Effect.die(new Error('Tool disappeared while saving a version'));
    }
    const lastRunStatus = yield* latestRunStatus(sql, input.tool.id);
    return {
      tool: toToolDetail(updated, version, lastRunStatus),
      version: toVersionDetail(version),
      unchanged: false,
    };
  });
}

// Lists the non-deleted tools of one AI in one topic (no source). The
// route decides which topics to query; the helper does not.
export async function listTools(
  db: ServerDatabase,
  input: { aiId: string; groupId: string | null; topicId: string | null },
): Promise<PublicTool[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const topic =
        input.topicId === null ? sql`topic_id IS NULL` : sql`topic_id = ${input.topicId}`;
      return yield* sql<ToolRow>`SELECT * FROM ai_tools
        WHERE ai_id = ${input.aiId} AND ${topic} AND deleted_at IS NULL
        ORDER BY name ASC`;
    }),
  );
  const result: PublicTool[] = [];
  for (const tool of rows) {
    const current = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
          WHERE tool_id = ${tool.id} AND version = ${tool.currentVersion} LIMIT 1`;
        return row ?? null;
      }),
    );
    const lastRunStatus = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* latestRunStatus(sql, tool.id);
      }),
    );
    result.push({
      id: tool.id,
      aiId: tool.aiId,
      groupId: tool.groupId,
      topicId: tool.topicId,
      name: tool.name,
      description: tool.description,
      currentVersion: tool.currentVersion,
      hosts: current?.hosts ?? [],
      approvedHosts: [...(tool.approvedHosts ?? [])],
      lastRunStatus,
      updatedAt: tool.updatedAt,
    });
  }
  return result;
}

// One non-deleted tool with its current source, or null for a missing id
// and a deleted one alike.
export async function getTool(db: ServerDatabase, id: string): Promise<ToolDetail | null> {
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, id);
    }),
  );
  if (!tool) {
    return null;
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
    return null;
  }
  const lastRunStatus = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* latestRunStatus(sql, tool.id);
    }),
  );
  return toToolDetail(tool, current, lastRunStatus);
}

// Every version of a tool, newest first, without source. Returns null for
// a missing or deleted tool.
export async function listVersions(
  db: ServerDatabase,
  toolId: string,
): Promise<PublicToolVersion[] | null> {
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, toolId);
    }),
  );
  if (!tool) {
    return null;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${toolId}
        ORDER BY version DESC`;
    }),
  );
  return rows.map(toPublicVersion);
}

// One version with source, or null for a missing/deleted tool or version.
export async function getVersion(
  db: ServerDatabase,
  toolId: string,
  version: number,
): Promise<ToolVersionDetail | null> {
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, toolId);
    }),
  );
  if (!tool) {
    return null;
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${toolId} AND version = ${version} LIMIT 1`;
    }),
  );
  return row ? toVersionDetail(row) : null;
}

export interface RevertToolInput {
  toolId: string;
  toVersion: number;
  userId: string;
  message?: string;
}

// Appends a new version copying an older version's source and hosts. The
// message is the standard `Revert to v<N>` unless the caller passes one.
// History is never rewritten: older rows are untouched.
export async function revertTool(
  db: ServerDatabase,
  input: RevertToolInput,
  now: Date,
): Promise<{ tool: ToolDetail; version: ToolVersionDetail }> {
  const message = input.message === undefined ? `Revert to v${input.toVersion}` : input.message;
  const parsed = parseToolVersionInput({
    name: 'revert-placeholder',
    description: 'revert placeholder',
    source: 'placeholder',
    hosts: [],
    message,
  });
  if (!parsed.ok) {
    throw new ToolServiceError('invalid_request', parsed.message);
  }
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [tool] = yield* sql<ToolRow>`SELECT * FROM ai_tools
            WHERE id = ${input.toolId} LIMIT 1 FOR UPDATE`;
          if (!tool || tool.deletedAt !== null) {
            return yield* Effect.fail(new ToolServiceError('not_found', 'Tool not found'));
          }
          const [old] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
            WHERE tool_id = ${tool.id} AND version = ${input.toVersion} LIMIT 1`;
          if (!old) {
            return yield* Effect.fail(new ToolServiceError('not_found', 'Tool version not found'));
          }
          if (tool.currentVersion >= MAX_VERSIONS_PER_TOOL) {
            return yield* Effect.fail(
              new ToolServiceError(
                'version_limit',
                `A tool has at most ${MAX_VERSIONS_PER_TOOL} versions`,
              ),
            );
          }
          const next = tool.currentVersion + 1;
          const version = yield* insertVersion(sql, {
            toolId: tool.id,
            version: next,
            source: old.source,
            hosts: old.hosts,
            message,
            createdBy: input.userId,
            now,
          });
          const [updated] = yield* sql<ToolRow>`UPDATE ai_tools
            SET current_version = ${next}, updated_at = ${now.toISOString()}
            WHERE id = ${tool.id}
            RETURNING *`;
          if (!updated) {
            return yield* Effect.die(new Error('Tool disappeared while reverting'));
          }
          const lastRunStatus = yield* latestRunStatus(sql, tool.id);
          return {
            tool: toToolDetail(updated, version, lastRunStatus),
            version: toVersionDetail(version),
          };
        }),
      );
    }),
  );
}

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

// Newest runs of a tool, newest first, capped at 20 for the public route.
// Returns null for a missing or deleted tool.
export async function listRuns(
  db: ServerDatabase,
  toolId: string,
  limit = 20,
): Promise<PublicToolRun[] | null> {
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, toolId);
    }),
  );
  if (!tool) {
    return null;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RunRow>`SELECT * FROM ai_tool_runs
        WHERE tool_id = ${toolId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${Math.max(1, Math.min(limit, 50))}`;
    }),
  );
  return rows.map(toPublicRun);
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
async function recordSaveAudit(audit: AuditRecorder, input: RecordSaveAuditInput): Promise<void> {
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

function insertVersion(
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

function findActiveTool(
  sql: SqlClient.SqlClient,
  aiId: string,
  topicId: string | null,
  name: string,
): Effect.Effect<ToolRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const topic = topicId === null ? sql`topic_id IS NULL` : sql`topic_id = ${topicId}`;
    const [row] = yield* sql<ToolRow>`SELECT * FROM ai_tools
      WHERE ai_id = ${aiId} AND ${topic} AND name = ${name} AND deleted_at IS NULL
      LIMIT 1`;
    return row ?? null;
  });
}

function enforceToolLimit(
  sql: SqlClient.SqlClient,
  aiId: string,
  topicId: string | null,
): Effect.Effect<void, SqlError.SqlError | ToolServiceError> {
  return Effect.gen(function* () {
    const topic = topicId === null ? sql`topic_id IS NULL` : sql`topic_id = ${topicId}`;
    const [row] = yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM ai_tools
      WHERE ai_id = ${aiId} AND ${topic} AND deleted_at IS NULL`;
    if (Number(row?.total ?? 0) >= MAX_TOOLS_PER_TOPIC) {
      return yield* Effect.fail(
        new ToolServiceError('tool_limit', `A topic has at most ${MAX_TOOLS_PER_TOPIC} tools`),
      );
    }
  });
}

function getToolRow(
  sql: SqlClient.SqlClient,
  toolId: string,
): Effect.Effect<ToolRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [tool] = yield* sql<ToolRow>`SELECT * FROM ai_tools WHERE id = ${toolId} LIMIT 1`;
    if (!tool || tool.deletedAt !== null) {
      return null;
    }
    return tool;
  });
}

// The newest run's status for one tool, or null when it has never run.
function latestRunStatus(
  sql: SqlClient.SqlClient,
  toolId: string,
): Effect.Effect<'ok' | 'error' | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [run] = yield* sql<{ status: 'ok' | 'error' }>`SELECT status FROM ai_tool_runs
      WHERE tool_id = ${toolId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1`;
    return run?.status ?? null;
  });
}

function hostsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((host, index) => host === b[index]);
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

function toToolDetail(
  tool: ToolRow,
  current: VersionRow,
  lastRunStatus: 'ok' | 'error' | null,
): ToolDetail {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    hosts: current.hosts,
    approvedHosts: [...(tool.approvedHosts ?? [])],
    source: current.source,
    lastRunStatus,
    updatedAt: tool.updatedAt,
  };
}

function toPublicVersion(row: VersionRow): PublicToolVersion {
  return {
    id: row.id,
    toolId: row.toolId,
    version: row.version,
    message: row.message,
    hosts: row.hosts,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toVersionDetail(row: VersionRow): ToolVersionDetail {
  return { ...toPublicVersion(row), source: row.source };
}

function toPublicRun(row: RunRow): PublicToolRun {
  return {
    id: row.id,
    toolId: row.toolId,
    version: row.version,
    trigger: row.trigger,
    status: row.status,
    errorKind: row.errorKind,
    durationMs: row.durationMs,
    fetchCount: row.fetchCount,
    outputText: row.outputText,
    createdAt: row.createdAt,
  };
}

// Counts the active tools of one AI across every topic, for the route that
// lists all of an AI's tools.
export async function listToolsForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<
  Array<
    PublicTool & {
      /** `personal` means the owner's DM with the AI; `group` a real group topic. */
      scope: 'personal' | 'group';
    }
  >
> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ToolRow>`SELECT * FROM ai_tools
        WHERE ai_id = ${aiId} AND deleted_at IS NULL
        ORDER BY name ASC`;
    }),
  );
  const result: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
  for (const tool of rows) {
    const current = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* sql<VersionRow>`SELECT * FROM ai_tool_versions
          WHERE tool_id = ${tool.id} AND version = ${tool.currentVersion} LIMIT 1`;
        return row ?? null;
      }),
    );
    const lastRunStatus = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* latestRunStatus(sql, tool.id);
      }),
    );
    result.push({
      id: tool.id,
      aiId: tool.aiId,
      groupId: tool.groupId,
      topicId: tool.topicId,
      name: tool.name,
      description: tool.description,
      currentVersion: tool.currentVersion,
      hosts: current?.hosts ?? [],
      approvedHosts: [...(tool.approvedHosts ?? [])],
      lastRunStatus,
      updatedAt: tool.updatedAt,
      scope: tool.groupId === null ? 'personal' : 'group',
    });
  }
  return result;
}
