import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import { RevertToolPayload, RunToolPayload, ToolsGroup } from '@zilar/api-contract';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import {
  handler,
  mountApi,
  schemaErrorLayer,
  sessionLayer,
  type EffectApiMount,
} from '../effect/http-core';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { createRateLimiter, type RateLimiter } from '../rate-limit';
import { canSeeTopic, getTopic } from '../topics/access';
import type { ToolRunner } from './types';
import {
  deleteTool,
  listTools,
  listToolsForAi,
  revertTool,
  runToolVersion,
  type PublicTool,
} from './service';
import {
  findMembership,
  findOwnedAiRow,
  listToolsForGroup,
  requireReadableRuns,
  requireReadableTool,
  requireReadableVersion,
  requireReadableVersions,
  toolAccess,
  toolAccessIncludingDeleted,
} from './access';
import {
  readJsonBody,
  runInputWithinLimit,
  toDetailWire,
  toListWire,
  toRevertWire,
  toRunListWire,
  toRunWire,
  toVersionDetailWire,
  toVersionListWire,
  withServiceErrors,
} from './wire';

// Manual runs are capped per user per minute.
export const TOOL_RUN_RATE_LIMIT_MAX = 5;
export const TOOL_RUN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

// `revert` and `run` declare their payloads in the contract for the derived
// client, but are served with `handleRaw`: their bodies are decoded by hand in
// the handlers, so the 400, 404, 429 and 501 order stays (see the header).
const ToolsApi = HttpApi.make('tools').add(ToolsGroup);

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

  const apiLayer = HttpApiBuilder.layer(ToolsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  return mountApi(ToolsApi, apiLayer);
}
