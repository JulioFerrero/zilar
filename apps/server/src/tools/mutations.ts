import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { hostsEqual } from './hosts';
import {
  enforceToolLimit,
  findActiveTool,
  latestRunStatus,
  MAX_VERSIONS_PER_TOOL,
  toToolDetail,
  toVersionDetail,
  ToolServiceError,
  type ToolRow,
  type VersionRow,
} from './queries';
import { insertVersion, recordSaveAudit } from './runner';
import { parseToolVersionInput } from './schemas';
import type {
  RevertToolInput,
  SaveToolVersionInput,
  SaveToolVersionResult,
  ToolDetail,
  ToolVersionDetail,
} from './service';

interface AppendVersionResult {
  tool: ToolDetail;
  version: ToolVersionDetail;
  // True when source and hosts matched, so no new row was written.
  unchanged: boolean;
}

// Creates version 1 or appends N+1 when source or hosts differ; an identical save returns the current version unchanged.
// One transaction with the tool row locked (`FOR UPDATE`), so concurrent saves end with consecutive versions; the audit is written after commit, ids only.
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
    const createdResult = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* enforceToolLimit(sql, input.aiId, input.topicId);
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
            // Lost the race with a concurrent create; `ON CONFLICT DO NOTHING` never aborts, so append to the winner's history.
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

// Appends N+1 inside the caller's transaction; the caller's lock on the tool row serialises concurrent appends.
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

// Appends a new version copying an older one; history is never rewritten.
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
