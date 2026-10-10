import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { AiToolRow, AiToolRunRow, AiToolVersionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type {
  PublicTool,
  PublicToolRun,
  PublicToolVersion,
  ToolDetail,
  ToolVersionDetail,
} from './service';

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

export type ToolRow = AiToolRow;
export type VersionRow = AiToolVersionRow;
export type RunRow = AiToolRunRow;

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
  const extras = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* listViewExtras(sql, rows);
    }),
  );
  const result: PublicTool[] = [];
  for (const tool of rows) {
    result.push({
      id: tool.id,
      aiId: tool.aiId,
      groupId: tool.groupId,
      topicId: tool.topicId,
      name: tool.name,
      description: tool.description,
      currentVersion: tool.currentVersion,
      hosts: extras.hosts.get(tool.id) ?? [],
      approvedHosts: [...(tool.approvedHosts ?? [])],
      lastRunStatus: extras.status.get(tool.id) ?? null,
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

export function findActiveTool(
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

export function enforceToolLimit(
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

export function getToolRow(
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
export function latestRunStatus(
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

// The list views of many tools in two queries, whatever the count: the
// hosts of each tool's current version (no source) and the newest run's
// status of each tool.
export function listViewExtras(
  sql: SqlClient.SqlClient,
  tools: readonly ToolRow[],
): Effect.Effect<
  { hosts: Map<string, string[]>; status: Map<string, 'ok' | 'error'> },
  SqlError.SqlError
> {
  return Effect.gen(function* () {
    const hosts = new Map<string, string[]>();
    const status = new Map<string, 'ok' | 'error'>();
    if (tools.length === 0) {
      return { hosts, status };
    }
    const ids = tools.map((tool) => tool.id);
    const versions = yield* sql<{ toolId: string; hosts: string[] }>`SELECT v.tool_id, v.hosts
      FROM ai_tool_versions v
      JOIN ai_tools t ON t.id = v.tool_id AND t.current_version = v.version
      WHERE v.tool_id IN ${sql.in(ids)}`;
    for (const row of versions) {
      hosts.set(row.toolId, row.hosts);
    }
    const runs = yield* sql<{ toolId: string; status: 'ok' | 'error' }>`
      SELECT DISTINCT ON (tool_id) tool_id, status FROM ai_tool_runs
      WHERE tool_id IN ${sql.in(ids)}
      ORDER BY tool_id, created_at DESC, id DESC`;
    for (const row of runs) {
      status.set(row.toolId, row.status);
    }
    return { hosts, status };
  });
}

export function toToolDetail(
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

export function toVersionDetail(row: VersionRow): ToolVersionDetail {
  return { ...toPublicVersion(row), source: row.source };
}

export function toPublicRun(row: RunRow): PublicToolRun {
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
  const extras = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* listViewExtras(sql, rows);
    }),
  );
  const result: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
  for (const tool of rows) {
    result.push({
      id: tool.id,
      aiId: tool.aiId,
      groupId: tool.groupId,
      topicId: tool.topicId,
      name: tool.name,
      description: tool.description,
      currentVersion: tool.currentVersion,
      hosts: extras.hosts.get(tool.id) ?? [],
      approvedHosts: [...(tool.approvedHosts ?? [])],
      lastRunStatus: extras.status.get(tool.id) ?? null,
      updatedAt: tool.updatedAt,
      scope: tool.groupId === null ? 'personal' : 'group',
    });
  }
  return result;
}
