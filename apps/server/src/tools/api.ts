// Tools module on the Effect `HttpApi` adapter (T-0559): the same methods,
// paths, statuses (204 on delete, 501 without a runner), bodies, audit calls
// and per-route step order as the router (`routes.ts`, now a thin wrapper
// below), mounted by the Effect edge (`apps/server/src/effect/edge.ts`).
// Its service runs on effect/sql.
//
// The revert and run bodies are decoded manually inside their handlers
// (Effect Schema, same rules as the old zod schemas) instead of as endpoint
// payloads, so each route keeps its exact order: session, then decode (400
// "Invalid run body"), then access (404 "Tool not found" unless the caller
// is a manager), then the run limiter (429), then the runner check (501).
// No decode text changes: every failure answers byte-identical codes and
// messages. Tool run output and input never appear in a log line, as before.

import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpServerRequest } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api';
import {
  RevertToolPayload,
  RunToolPayload,
  ToolsSchemaErrors,
  ToolsServerGroup,
} from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import {
  failureResponse,
  handler,
  mountApi,
  requestIdOf,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { canSeeTopic, getTopic, type TopicRow } from '../topics/access';
import type { ToolRunner } from './types';
import {
  deleteTool,
  getTool,
  getVersion,
  listRuns,
  listToolsForAi,
  listTools,
  listVersions,
  revertTool,
  runToolVersion,
  ToolServiceError,
  type PublicTool,
  type PublicToolRun,
  type PublicToolVersion,
  type ToolDetail,
  type ToolVersionDetail,
} from './service';

// Manual runs are capped per user per minute.
export const TOOL_RUN_RATE_LIMIT_MAX = 5;
export const TOOL_RUN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// `input` serialises to at most 16 KiB (T-0105, shared with the `tool.run`
// adapter): anything larger is 400 `invalid_request` before any run.
export const MAX_TOOL_RUN_INPUT_BYTES = 16 * 1024;

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// A params decode failure renders as 400 `invalid_request` through the shared
// envelope.
function schemaErrorLayer(logger: Logger): Layer.Layer<ToolsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ToolsSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message),
      );
    }),
  );
}

// The server group declares no payload on `revert` and `run`: their bodies
// are decoded by hand in the handlers (see the header). The derived clients
// use `ToolsGroup`.
const ToolsApi = HttpApi.make('tools').add(ToolsServerGroup);

export interface ToolsApiDependencies {
  auth: Auth;
  db: ServerDatabase;
  logger: Logger;
  audit?: AuditRecorder;
  /** Absent = no runner (T-0105 wires the sandbox): run answers 501. */
  toolRunner?: ToolRunner;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
  /** Injected so tests can share one limiter; otherwise built from `now`. */
  runLimiter?: RateLimiter;
}

export function createToolsApi(deps: ToolsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const runLimiter =
    deps.runLimiter ??
    createRateLimiter({
      max: TOOL_RUN_RATE_LIMIT_MAX,
      windowMs: TOOL_RUN_RATE_LIMIT_WINDOW_MS,
      now,
    });

  const groupLayer = HttpApiBuilder.group(ToolsApi, 'tools', (handlers) =>
    handlers
      .handle(
        'listForAi',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const ai = yield* Effect.promise(() =>
              findOwnedAiRow(deps.db, request.params.id, user.id),
            );
            if (!ai) {
              throw new HttpError(404, 'not_found', 'AI not found');
            }
            // Only tools of topics the owner can see: tools in a private topic the
            // owner was removed from stay hidden until they are added back.
            const tools = yield* Effect.promise(() => listToolsForAi(deps.db, ai.id));
            const visible: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
            for (const tool of tools) {
              if (tool.topicId === null) {
                visible.push(tool);
                continue;
              }
              const topicId = tool.topicId;
              const topic = yield* Effect.promise(() => getTopic(deps.db, topicId));
              if (topic && (yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))) {
                visible.push(tool);
              }
            }
            return visible.map(toListWire);
          }),
        ),
      )
      .handle(
        'listForGroup',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const groupId = request.params.id;
            const membership = yield* Effect.promise(() =>
              findMembership(deps.db, groupId, user.id),
            );
            if (!membership) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            // Only tools of topics the viewer can see: a group admin who is not in
            // a private topic never sees its tools.
            const tools = yield* Effect.promise(() => listToolsForGroup(deps.db, groupId, user.id));
            return tools.map(toListWire);
          }),
        ),
      )
      // T-0110: the tools of one topic. Anyone who can see the topic reads;
      // anyone else gets the same 404 as a missing id.
      .handle(
        'listForTopic',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const topicId = request.params.id;
            const topic = yield* Effect.promise(() => getTopic(deps.db, topicId));
            if (
              !topic ||
              topic.archivedAt !== null ||
              !(yield* Effect.promise(() => canSeeTopic(deps.db, topic, user.id)))
            ) {
              throw new HttpError(404, 'not_found', 'Topic not found');
            }
            const result: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
            const aiRows = yield* Effect.promise(() =>
              runSql(
                deps.db,
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient;
                  return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
                    WHERE group_id = ${topic.groupId}`;
                }),
              ),
            );
            const topicAiRows = yield* Effect.promise(() =>
              runSql(
                deps.db,
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient;
                  return yield* sql<{ aiId: string }>`SELECT ai_id FROM topic_ais
                    WHERE topic_id = ${topic.id}`;
                }),
              ),
            );
            const aiIds = new Set([
              ...aiRows.map((row) => row.aiId),
              ...topicAiRows.map((row) => row.aiId),
            ]);
            for (const aiId of aiIds) {
              const tools = yield* Effect.promise(() =>
                listTools(deps.db, { aiId, groupId: topic.groupId, topicId: topic.id }),
              );
              for (const tool of tools) {
                result.push({ ...tool, scope: 'group' as const });
              }
            }
            return result.map(toListWire);
          }),
        ),
      )
      .handle(
        'detail',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const tool = yield* Effect.promise(() =>
              requireReadableTool(deps.db, request.params.id, user.id),
            );
            return toDetailWire(tool);
          }),
        ),
      )
      .handle(
        'versions',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const versions = yield* Effect.promise(() =>
              requireReadableVersions(deps.db, request.params.id, user.id),
            );
            return versions.map(toVersionListWire);
          }),
        ),
      )
      .handle(
        'version',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const version = yield* Effect.promise(() =>
              requireReadableVersion(deps.db, request.params.id, request.params.n, user.id),
            );
            return toVersionDetailWire(version);
          }),
        ),
      )
      .handle(
        'runs',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const runs = yield* Effect.promise(() =>
              requireReadableRuns(deps.db, request.params.id, user.id),
            );
            return runs.map(toRunListWire);
          }),
        ),
      )
      .handle(
        'revert',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const body = yield* readJsonBody(request.request);
            if (!body.parsed) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const decoded = Schema.decodeUnknownOption(
              RevertToolPayload,
              STRICT_DECODE,
            )(body.value);
            if (Option.isNone(decoded)) {
              throw new HttpError(400, 'invalid_request', 'Invalid revert body');
            }
            const toolId = request.params.id;
            const access = yield* Effect.promise(() => toolAccess(deps.db, toolId, user.id));
            if (!access || !access.manager) {
              throw new HttpError(404, 'not_found', 'Tool not found');
            }
            const nowDate = new Date(now());
            const { tool, version } = yield* withServiceErrors(() =>
              revertTool(
                deps.db,
                {
                  toolId,
                  toVersion: decoded.value.version,
                  userId: user.id,
                  ...(decoded.value.message === undefined
                    ? null
                    : { message: decoded.value.message }),
                },
                nowDate,
              ),
            );
            if (deps.audit !== undefined) {
              yield* Effect.promise(() =>
                (deps.audit as AuditRecorder).record({
                  actorUserId: user.id,
                  aiId: access.tool.aiId,
                  groupId: access.tool.groupId,
                  action: 'tool.reverted',
                  subjectId: tool.id,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: { name: tool.name, version: version.version },
                }),
              );
            }
            return toRevertWire(tool, version);
          }),
        ),
      )
      .handle(
        'remove',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const toolId = request.params.id;
            // `toolAccess` hides soft-deleted rows (they read as missing), but the
            // delete must be idempotent: a manager re-deleting sees 204, like the
            // approval-rule revoke. So managers are resolved on the raw row here,
            // including deleted ones; strangers still get the missing-id 404.
            const access = yield* Effect.promise(() =>
              toolAccessIncludingDeleted(deps.db, toolId, user.id),
            );
            if (!access || !access.manager) {
              throw new HttpError(404, 'not_found', 'Tool not found');
            }
            const { deleted } = yield* Effect.promise(() =>
              deleteTool(deps.db, toolId, new Date(now())),
            );
            if (deleted && deps.audit !== undefined) {
              yield* Effect.promise(() =>
                (deps.audit as AuditRecorder).record({
                  actorUserId: user.id,
                  aiId: access.tool.aiId,
                  groupId: access.tool.groupId,
                  action: 'tool.deleted',
                  subjectId: toolId,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: { name: access.tool.name, version: access.tool.currentVersion },
                }),
              );
            }
          }),
        ),
      )
      .handle(
        'run',
        handler(logger, (request, user) =>
          Effect.gen(function* () {
            const body = yield* readJsonBody(request.request);
            if (!body.parsed) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const decoded = Schema.decodeUnknownOption(RunToolPayload, STRICT_DECODE)(body.value);
            if (Option.isNone(decoded) || !runInputWithinLimit(decoded.value.input)) {
              throw new HttpError(400, 'invalid_request', 'Invalid run body');
            }
            const toolId = request.params.id;
            const access = yield* Effect.promise(() => toolAccess(deps.db, toolId, user.id));
            if (!access || !access.manager) {
              throw new HttpError(404, 'not_found', 'Tool not found');
            }
            if (!runLimiter.allow(user.id)) {
              throw new HttpError(429, 'rate_limited', 'Too many tool runs, try again in a minute');
            }
            if (deps.toolRunner === undefined) {
              throw new HttpError(
                501,
                'runner_unavailable',
                'No tool runner is configured on this server',
              );
            }
            const toolRunner = deps.toolRunner;
            const { result, run } = yield* withServiceErrors(() =>
              runToolVersion(
                { db: deps.db, runner: toolRunner },
                {
                  toolId,
                  trigger: 'manual',
                  ...(decoded.value.version === undefined
                    ? null
                    : { version: decoded.value.version }),
                  ...(decoded.value.input === undefined ? null : { input: decoded.value.input }),
                },
                new Date(now()),
              ),
            );
            if (deps.audit !== undefined) {
              yield* Effect.promise(() =>
                (deps.audit as AuditRecorder).record({
                  actorUserId: user.id,
                  aiId: access.tool.aiId,
                  groupId: access.tool.groupId,
                  action: 'tool.run',
                  subjectId: toolId,
                  argsHash: null,
                  costCurrency: null,
                  costAmount: null,
                  result: 'ok',
                  detail: { name: access.tool.name, version: run.version, status: run.status },
                }),
              );
            }
            return toRunWire(result);
          }),
        ),
      ),
  );

  const apiLayer = HttpApiBuilder.layer(ToolsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ToolsApi, apiLayer);
}

function toListWire(tool: PublicTool & { scope: 'personal' | 'group' }) {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    hosts: [...tool.hosts],
    approvedHosts: [...tool.approvedHosts],
    lastRunStatus: tool.lastRunStatus,
    updatedAt: tool.updatedAt.toISOString(),
    scope: tool.scope,
  };
}

function toDetailWire(tool: ToolDetail) {
  return {
    ...toListWire({
      ...tool,
      scope: tool.groupId === null ? ('personal' as const) : ('group' as const),
    }),
    source: tool.source,
  };
}

function toVersionListWire(version: PublicToolVersion) {
  return {
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    message: version.message,
    hosts: [...version.hosts],
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  };
}

function toVersionDetailWire(version: ToolVersionDetail) {
  return {
    ...toVersionListWire(version),
    source: version.source,
  };
}

function toRunListWire(run: PublicToolRun) {
  return {
    id: run.id,
    toolId: run.toolId,
    version: run.version,
    trigger: run.trigger,
    status: run.status,
    errorKind: run.errorKind,
    durationMs: run.durationMs,
    fetchCount: run.fetchCount,
    outputText: run.outputText,
    createdAt: run.createdAt.toISOString(),
  };
}

function toRevertWire(
  tool: { id: string; name: string },
  version: {
    id: string;
    toolId: string;
    version: number;
    message: string;
    hosts: string[];
    createdBy: string;
    createdAt: Date;
  },
) {
  return {
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    message: version.message,
    hosts: [...version.hosts],
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    toolName: tool.name,
  };
}

function toRunWire(result: Awaited<ReturnType<typeof runToolVersion>>['result']) {
  if (result.ok) {
    return {
      ok: true as const,
      output: {
        text: result.output.text,
        ...(result.output.data === undefined ? null : { data: result.output.data }),
      },
      logs: result.logs,
      durationMs: result.durationMs,
      fetchCount: result.fetchCount,
    };
  }
  return {
    ok: false as const,
    error: result.error,
    logs: result.logs,
    durationMs: result.durationMs,
    fetchCount: result.fetchCount,
  };
}

// The old `runBodySchema` refine: `input` must serialise to at most 16 KiB
// of UTF-8, and a value that cannot be stringified fails.
function runInputWithinLimit(input: unknown): boolean {
  if (input === undefined) {
    return true;
  }
  let serialised: string | null;
  try {
    serialised = JSON.stringify(input) ?? 'null';
  } catch {
    return false;
  }
  return Buffer.byteLength(serialised, 'utf8') <= MAX_TOOL_RUN_INPUT_BYTES;
}

// Reads the request body as JSON without throwing: a malformed body answers
// `Invalid JSON body`, exactly like the old `readJson`.
function readJsonBody(
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<{ parsed: boolean; value: unknown }> {
  return request.json.pipe(
    Effect.map((value: unknown) => ({ parsed: true as const, value })),
    Effect.catchCause(() =>
      Effect.succeed({ parsed: false as const, value: undefined as unknown }),
    ),
  );
}

// Reader = the AI's owner who can see the topic, or a member of the
// topic. Manager = the AI's owner who can see the topic, or a group
// owner/admin who can see the topic. Returns null for a missing/deleted
// tool, a blind viewer, or a stranger (same shape for all, so existence
// is never leaked).
async function toolAccess(
  db: ServerDatabase,
  toolId: string,
  userId: string,
): Promise<{ tool: NonNullable<Awaited<ReturnType<typeof getTool>>>; manager: boolean } | null> {
  const tool = await getTool(db, toolId);
  if (!tool) {
    return null;
  }
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${tool.aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    return null;
  }
  if (tool.topicId === null) {
    // Personal-chat tool: the AI owner only.
    return ai.owner === userId ? { tool, manager: true } : null;
  }
  const topic = await getTopic(db, tool.topicId);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  if (ai.owner === userId) {
    return { tool, manager: true };
  }
  const membership = await findMembership(db, tool.groupId as string, userId);
  if (!membership) {
    return null;
  }
  return { tool, manager: membership.role === 'owner' || membership.role === 'admin' };
}

// Same manager check as `toolAccess`, but on the raw tool row — including
// soft-deleted ones. Only the DELETE route uses this (idempotent 204);
// every other route goes through `toolAccess`, so deleted tools still
// read as missing everywhere else.
async function toolAccessIncludingDeleted(
  db: ServerDatabase,
  toolId: string,
  userId: string,
): Promise<{
  tool: {
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    name: string;
    currentVersion: number;
  };
  manager: boolean;
} | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        aiId: string;
        groupId: string | null;
        topicId: string | null;
        name: string;
        currentVersion: number;
      }>`SELECT ai_id, group_id, topic_id, name, current_version FROM ai_tools
        WHERE id = ${toolId} LIMIT 1`;
    }),
  );
  if (!row) {
    return null;
  }
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${row.aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    return null;
  }
  if (row.topicId === null) {
    return ai.owner === userId ? { tool: row, manager: true } : null;
  }
  const topic = await getTopic(db, row.topicId);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  if (ai.owner === userId) {
    return { tool: row, manager: true };
  }
  if (row.groupId === null) {
    return null;
  }
  const membership = await findMembership(db, row.groupId, userId);
  if (!membership) {
    return null;
  }
  return { tool: row, manager: membership.role === 'owner' || membership.role === 'admin' };
}

async function requireReadableTool(db: ServerDatabase, toolId: string, userId: string) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  return access.tool;
}

async function requireReadableVersions(db: ServerDatabase, toolId: string, userId: string) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  const versions = await listVersions(db, toolId);
  if (!versions) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  return versions;
}

async function requireReadableVersion(
  db: ServerDatabase,
  toolId: string,
  versionParam: string,
  userId: string,
) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  const parsed = Number.parseInt(versionParam, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(404, 'not_found', 'Tool version not found');
  }
  const version = await getVersion(db, toolId, parsed);
  if (!version) {
    throw new HttpError(404, 'not_found', 'Tool version not found');
  }
  return version;
}

async function requireReadableRuns(db: ServerDatabase, toolId: string, userId: string) {
  const access = await toolAccess(db, toolId, userId);
  if (!access) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  const runs = await listRuns(db, toolId, 20);
  if (!runs) {
    throw new HttpError(404, 'not_found', 'Tool not found');
  }
  return runs;
}

// All non-deleted tools of every AI attached to a group, each with its
// scope — but only in topics the viewer can see. The caller is a member
// (checked by the route); the helper additionally gates each topic.
async function listToolsForGroup(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<Array<PublicTool & { scope: 'personal' | 'group' }>> {
  const topicRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  const result: Array<PublicTool & { scope: 'personal' | 'group' }> = [];
  for (const topic of topicRows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    if (!(await canSeeTopic(db, topic, userId))) {
      continue;
    }
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
          WHERE group_id = ${groupId}`;
      }),
    );
    const topicAiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string }>`SELECT ai_id FROM topic_ais
          WHERE topic_id = ${topic.id}`;
      }),
    );
    const aiIds = new Set([
      ...aiRows.map((row) => row.aiId),
      ...topicAiRows.map((row) => row.aiId),
    ]);
    for (const aiId of aiIds) {
      const tools = await listTools(db, { aiId, groupId, topicId: topic.id });
      for (const tool of tools) {
        result.push({ ...tool, scope: 'group' as const });
      }
    }
  }
  return result;
}

async function findOwnedAiRow(db: ServerDatabase, aiId: string, ownerId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais
        WHERE id = ${aiId} AND owner = ${ownerId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function findMembership(db: ServerDatabase, groupId: string, userId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: 'owner' | 'admin' | 'member' }>`SELECT role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

function mapServiceError(error: unknown): unknown {
  if (error instanceof ToolServiceError) {
    if (error.errorCode === 'not_found') {
      return new HttpError(404, 'not_found', 'Tool not found');
    }
    if (error.errorCode === 'ai_not_active') {
      return new HttpError(409, 'ai_not_active', 'The AI is not active');
    }
    if (error.errorCode === 'version_limit' || error.errorCode === 'tool_limit') {
      return new HttpError(400, error.errorCode, error.message);
    }
    return new HttpError(400, 'invalid_request', error.message);
  }
  return error;
}

// Service rejections travel as defects (`Effect.promise`), which `try/catch`
// inside `Effect.gen` cannot see: map them with `catchDefect` and re-die so
// the envelope renders the mapped answer. Unknown rejections pass through
// unchanged and stay a 500, exactly like the old route's unmapped throw.
function withServiceErrors<A>(promise: () => Promise<A>): Effect.Effect<A> {
  return Effect.promise(promise).pipe(
    Effect.catchDefect((defect) => Effect.die(mapServiceError(defect))),
  );
}
