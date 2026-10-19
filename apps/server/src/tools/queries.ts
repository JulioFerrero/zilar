import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { PublicTool, PublicToolVersion, ToolDetail, ToolVersionDetail } from './service';
import { type AiToolRow, type AiToolRunRow, type AiToolVersionRow } from '../db/rows-agents';

function toPublicTool(
  tool: AiToolRow,
  hosts: string[],
  lastRunStatus: 'ok' | 'error' | null,
): PublicTool {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    hosts,
    approvedHosts: [...(tool.approvedHosts ?? [])],
    lastRunStatus,
    updatedAt: tool.updatedAt,
  };
}

export function toToolDetail(
  tool: AiToolRow,
  current: AiToolVersionRow,
  lastRunStatus: 'ok' | 'error' | null,
): ToolDetail {
  return { ...toPublicTool(tool, current.hosts, lastRunStatus), source: current.source };
}

function toPublicVersion(row: AiToolVersionRow): PublicToolVersion {
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

export function toVersionDetail(row: AiToolVersionRow): ToolVersionDetail {
  return { ...toPublicVersion(row), source: row.source };
}

export function toPublicRun(row: AiToolRunRow): AiToolRunRow {
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
// At most 20 active tools per (AI, topic), 200 versions per tool, 2 KiB stored output, newest 50 runs.
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

// Lists the non-deleted tools of one AI in one topic, without source.
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
      return yield* sql<AiToolRow>`SELECT * FROM ai_tools
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
  const result: PublicTool[] = rows.map((tool) =>
    toPublicTool(tool, extras.hosts.get(tool.id) ?? [], extras.status.get(tool.id) ?? null),
  );
  return result;
}

// One non-deleted tool with its current source, or null.
export async function getTool(db: ServerDatabase, id: string): Promise<ToolDetail | null> {
  const tool = await loadTool(db, id);
  if (!tool) {
    return null;
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

// Every version of a tool, newest first, without source.
export async function listVersions(
  db: ServerDatabase,
  toolId: string,
): Promise<PublicToolVersion[] | null> {
  const tool = await loadTool(db, toolId);
  if (!tool) {
    return null;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiToolVersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${toolId}
        ORDER BY version DESC`;
    }),
  );
  return rows.map(toPublicVersion);
}

export async function getVersion(
  db: ServerDatabase,
  toolId: string,
  version: number,
): Promise<ToolVersionDetail | null> {
  const tool = await loadTool(db, toolId);
  if (!tool) {
    return null;
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiToolVersionRow>`SELECT * FROM ai_tool_versions
        WHERE tool_id = ${toolId} AND version = ${version} LIMIT 1`;
    }),
  );
  return row ? toVersionDetail(row) : null;
}

// Newest runs of a tool, capped at 20 for the public route.
export async function listRuns(
  db: ServerDatabase,
  toolId: string,
  limit = 20,
): Promise<AiToolRunRow[] | null> {
  const tool = await loadTool(db, toolId);
  if (!tool) {
    return null;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiToolRunRow>`SELECT * FROM ai_tool_runs
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
): Effect.Effect<AiToolRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const topic = topicId === null ? sql`topic_id IS NULL` : sql`topic_id = ${topicId}`;
    const [row] = yield* sql<AiToolRow>`SELECT * FROM ai_tools
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
    // The count and insert share one transaction, so the cap is read under a lock keyed on the AI and topic.
    yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`tools:${aiId}:${topicId ?? ''}`}))`;
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
): Effect.Effect<AiToolRow | null, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [tool] = yield* sql<AiToolRow>`SELECT * FROM ai_tools WHERE id = ${toolId} LIMIT 1`;
    if (!tool || tool.deletedAt !== null) {
      return null;
    }
    return tool;
  });
}

async function loadTool(db: ServerDatabase, toolId: string): Promise<AiToolRow | null> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* getToolRow(sql, toolId);
    }),
  );
}

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

// The list views of many tools in two queries, whatever the count.
export function listViewExtras(
  sql: SqlClient.SqlClient,
  tools: readonly AiToolRow[],
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

// Counts the active tools of one AI across every topic.
export async function listToolsForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<
  Array<
    PublicTool & {
      // `personal` means the owner's DM with the AI; `group` a real group topic.
      scope: 'personal' | 'group';
    }
  >
> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiToolRow>`SELECT * FROM ai_tools
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
  const result: Array<PublicTool & { scope: 'personal' | 'group' }> = rows.map((tool) => ({
    ...toPublicTool(tool, extras.hosts.get(tool.id) ?? [], extras.status.get(tool.id) ?? null),
    scope: tool.groupId === null ? 'personal' : 'group',
  }));
  return result;
}
