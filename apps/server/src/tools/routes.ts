import type { ServerCore } from '../app/deps';
import type { AiToolRunRow } from '../db/rows';
import { Effect, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { RevertToolPayload, RunToolPayload, ToolsGroup } from '@zilar/api-contract';

import type { AuditRecorder } from '../audit/recorder';

import { mountGroups, handler, type EffectApiMount } from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { findGroupMembership } from '../groups/access';
import { limiter, type RateLimiter } from '../rate-limit';
import { withServiceErrors as withServiceErrorsMapped } from '../routines/status-errors';
import { canSeeTopic, getTopic } from '../topics/access';
import type { ToolRunner } from './types';
import {
  deleteTool,
  listTools,
  listToolsForAi,
  revertTool,
  runToolVersion,
  ToolServiceError,
  type PublicTool,
  type PublicToolVersion,
  type ToolDetail,
  type ToolVersionDetail,
} from './service';
import {
  findOwnedAiRow,
  listToolsForGroup,
  requireReadableRuns,
  requireReadableTool,
  requireReadableVersion,
  requireReadableVersions,
  toolAccess,
  toolAccessIncludingDeleted,
} from './access';
import { HttpServerRequest } from 'effect/http';

// Manual runs are capped per user per minute.
const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// `revert` and `run` declare payloads for the client but decode by hand, keeping the 400/404/429/501 order.
const ToolsApi = HttpApi.make('tools').add(ToolsGroup);

export interface ToolsApiDependencies extends Pick<ServerCore, 'auth' | 'db' | 'logger'> {
  audit?: AuditRecorder;
  // Absent = no runner; run answers 501.
  toolRunner?: ToolRunner;
  now?: () => number;
  // Injected so tests can share one limiter; otherwise built from `now`.
  runLimiter?: RateLimiter;
}

export function createToolsApi(deps: ToolsApiDependencies): EffectApiMount {
  const logger = deps.logger;
  const now = deps.now ?? Date.now;
  const runLimiter = deps.runLimiter ?? limiter('toolRun', now);

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
            // Tools in a private topic the owner was removed from stay hidden until they are added back.
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
              findGroupMembership(deps.db, groupId, user.id),
            );
            if (!membership) {
              throw new HttpError(404, 'not_found', 'Group not found');
            }
            // A group admin not in a private topic never sees its tools.
            const tools = yield* Effect.promise(() => listToolsForGroup(deps.db, groupId, user.id));
            return tools.map(toListWire);
          }),
        ),
      )
      // Anyone who can see the topic reads; anyone else gets the same 404 as a missing id.
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
      .handleRaw(
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
            // Resolve managers on the raw row so a re-delete is 204; strangers still get the missing-id 404.
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
      .handleRaw(
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

  return mountGroups(ToolsApi, groupLayer, {
    auth: deps.auth,
    logger,
    schemaErrors: true,
  });
}

// `input` serialises to at most 16 KiB; larger is 400 `invalid_request` before any run.
export const MAX_TOOL_RUN_INPUT_BYTES = 16 * 1024;

export function toListWire(tool: PublicTool & { scope: 'personal' | 'group' }) {
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

export function toDetailWire(tool: ToolDetail) {
  return {
    ...toListWire({
      ...tool,
      scope: tool.groupId === null ? ('personal' as const) : ('group' as const),
    }),
    source: tool.source,
  };
}

export function toVersionListWire(version: PublicToolVersion) {
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

export function toVersionDetailWire(version: ToolVersionDetail) {
  return {
    ...toVersionListWire(version),
    source: version.source,
  };
}

export function toRunListWire(run: AiToolRunRow) {
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

export function toRevertWire(
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

export function toRunWire(result: Awaited<ReturnType<typeof runToolVersion>>['result']) {
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

// `input` must serialise to at most 16 KiB of UTF-8; one that cannot be stringified fails.
export function runInputWithinLimit(input: unknown): boolean {
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

// A malformed body answers `Invalid JSON body`.
export function readJsonBody(
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<{ parsed: boolean; value: unknown }> {
  return request.json.pipe(
    Effect.map((value: unknown) => ({ parsed: true as const, value })),
    Effect.catchCause(() =>
      Effect.succeed({ parsed: false as const, value: undefined as unknown }),
    ),
  );
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

// The shared wrapper with the tools mapper; only the allowed codes differ.
export const withServiceErrors = <A>(promise: () => Promise<A>): Effect.Effect<A> =>
  withServiceErrorsMapped(promise, mapServiceError);
