// Tools module on the Effect `HttpApi` adapter (T-0559): the same methods,
// paths, statuses (204 on delete, 501 without a runner), bodies, audit calls
// and per-route step order as the Hono router (`routes.ts`, now a thin
// wrapper below), mounted under Hono by `apps/server/src/effect/http.ts`.
// Handlers keep calling the drizzle service; the DB rewrite is a separate lane.
//
// The revert and run bodies are decoded manually inside their handlers
// (Effect Schema, same rules as the old zod schemas) instead of as endpoint
// payloads, so each route keeps its exact order: session, then decode (400
// "Invalid run body"), then access (404 "Tool not found" unless the caller
// is a manager), then the run limiter (429), then the runner check (501).
// No decode text changes: every failure answers byte-identical codes and
// messages. Tool run output and input never appear in a log line, as before.

import { Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import { HttpServer, HttpServerRequest, HttpServerResponse, HttpRouter } from 'effect/http';
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from 'effect/http-api';
import type { Logger } from 'pino';
import type { AuditRecorder } from '../audit/service';
import type { Auth } from '../auth/auth';
import type { ServerDatabase } from '../db/client';
import {
  CurrentUser,
  Session,
  failureResponse,
  requestIdOf,
  sessionLayer,
  withErrorEnvelope,
  type EffectApiMount,
  type EffectApiRoute,
} from '../effect/http';
import { sqlRuntimeFor } from '../effect/sql';
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

// Every read runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported surface stays the same.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// Manual runs are capped per user per minute.
export const TOOL_RUN_RATE_LIMIT_MAX = 5;
export const TOOL_RUN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// `input` serialises to at most 16 KiB (T-0105, shared with the `tool.run`
// adapter): anything larger is 400 `invalid_request` before any run.
export const MAX_TOOL_RUN_INPUT_BYTES = 16 * 1024;

// Replaces `revertBodySchema` (zod strict): excess keys fail the decode.
const RevertBody = Schema.Struct({
  version: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  message: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  ),
});

// Replaces `runBodySchema` (zod strict): excess keys fail the decode. The
// 16 KiB `input` check runs manually after the decode (see below), so its
// failure answers the same `Invalid run body` text.
const RunBody = Schema.Struct({
  input: Schema.optional(Schema.Unknown),
  version: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  ),
});

const STRICT_DECODE = { onExcessProperty: 'error' } as const;

const ToolScope = Schema.Literals(['personal', 'group']);
const ToolLastRunStatus = Schema.NullOr(Schema.Literals(['ok', 'error']));

// The list shape is the full `PublicTool` plus scope, dates as the ISO
// strings `c.json` used to write. Every field of the service return type is
// listed, so no field is silently stripped by the success encoding.
const ToolListItem = Schema.Struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.String,
  currentVersion: Schema.Number,
  hosts: Schema.Array(Schema.String),
  approvedHosts: Schema.Array(Schema.String),
  lastRunStatus: ToolLastRunStatus,
  updatedAt: Schema.String,
  scope: ToolScope,
});

const ToolList = Schema.Array(ToolListItem);

// The detail shape is the list shape plus the current source.
const ToolDetailView = Schema.Struct({
  ...ToolListItem.fields,
  source: Schema.String,
});

// The versions shape is every field of `PublicToolVersion`, without source.
const ToolVersionItem = Schema.Struct({
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  message: Schema.String,
  hosts: Schema.Array(Schema.String),
  createdBy: Schema.String,
  createdAt: Schema.String,
});

const ToolVersionList = Schema.Array(ToolVersionItem);

// One version with source: every field of `ToolVersionDetail`.
const ToolVersionView = Schema.Struct({
  ...ToolVersionItem.fields,
  source: Schema.String,
});

// Every field of `PublicToolRun`; the output text is the stored (truncated)
// column, never the live run output.
const ToolRunItem = Schema.Struct({
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  trigger: Schema.Literals(['manual', 'routine', 'ai']),
  status: Schema.Literals(['ok', 'error']),
  errorKind: Schema.NullOr(Schema.String),
  durationMs: Schema.Number,
  fetchCount: Schema.Number,
  outputText: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

const ToolRunList = Schema.Array(ToolRunItem);

// The revert answer: the new version plus the tool name.
const RevertView = Schema.Struct({
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  message: Schema.String,
  hosts: Schema.Array(Schema.String),
  createdBy: Schema.String,
  createdAt: Schema.String,
  toolName: Schema.String,
});

// The run answer: the old `toRunWire` shape. `data` stays optional so an
// output without data encodes exactly like `c.json` wrote it.
const RunOutput = Schema.Struct({
  text: Schema.String,
  data: Schema.optional(Schema.Unknown),
});

const RunResultView = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    output: RunOutput,
    logs: Schema.String,
    durationMs: Schema.Number,
    fetchCount: Schema.Number,
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({ kind: Schema.String, message: Schema.String }),
    logs: Schema.String,
    durationMs: Schema.Number,
    fetchCount: Schema.Number,
  }),
]);
const ToolIdParams = Schema.Struct({ id: Schema.String });
const ToolVersionParams = Schema.Struct({ id: Schema.String, n: Schema.String });

// A params decode failure renders like the old path: a 400
// `invalid_request`. Params are plain strings so this never fires; the
// layer exists so the group middleware reads like the other modules.
class ToolsSchemaErrors extends HttpApiMiddleware.Service<ToolsSchemaErrors>()(
  'zilar/effect/http/ToolsSchemaErrors',
) {}

function schemaErrorLayer(logger: Logger): Layer.Layer<ToolsSchemaErrors> {
  return HttpApiMiddleware.layerSchemaErrorTransform(ToolsSchemaErrors, (error) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return failureResponse(
        logger,
        requestIdOf(request),
        new HttpError(400, 'invalid_request', error.cause.message || 'Invalid request'),
      );
    }),
  );
}

const ToolsGroup = HttpApiGroup.make('tools')
  .add(
    HttpApiEndpoint.get('listForAi', '/ais/:id/tools', {
      params: ToolIdParams,
      success: ToolList,
    }),
    HttpApiEndpoint.get('listForGroup', '/groups/:id/tools', {
      params: ToolIdParams,
      success: ToolList,
    }),
    HttpApiEndpoint.get('listForTopic', '/topics/:id/tools', {
      params: ToolIdParams,
      success: ToolList,
    }),
    HttpApiEndpoint.get('detail', '/tools/:id', {
      params: ToolIdParams,
      success: ToolDetailView,
    }),
    HttpApiEndpoint.get('versions', '/tools/:id/versions', {
      params: ToolIdParams,
      success: ToolVersionList,
    }),
    HttpApiEndpoint.get('version', '/tools/:id/versions/:n', {
      params: ToolVersionParams,
      success: ToolVersionView,
    }),
    HttpApiEndpoint.get('runs', '/tools/:id/runs', {
      params: ToolIdParams,
      success: ToolRunList,
    }),
    HttpApiEndpoint.post('revert', '/tools/:id/revert', {
      params: ToolIdParams,
      success: RevertView,
    }),
    HttpApiEndpoint.delete('remove', '/tools/:id', {
      params: ToolIdParams,
      success: Schema.Void,
    }),
    HttpApiEndpoint.post('run', '/tools/:id/run', {
      params: ToolIdParams,
      success: RunResultView,
    }),
  )
  .middleware(Session)
  .middleware(ToolsSchemaErrors)
  // The adapter forwards `c.req.raw` unchanged, so paths keep Hono's `/api`.
  .prefix('/api');

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

export const TOOLS_API_ROUTES: ReadonlyArray<EffectApiRoute> = [
  { method: 'GET', path: '/api/ais/:id/tools' },
  { method: 'GET', path: '/api/groups/:id/tools' },
  { method: 'GET', path: '/api/topics/:id/tools' },
  { method: 'GET', path: '/api/tools/:id' },
  { method: 'GET', path: '/api/tools/:id/versions' },
  { method: 'GET', path: '/api/tools/:id/versions/:n' },
  { method: 'GET', path: '/api/tools/:id/runs' },
  { method: 'POST', path: '/api/tools/:id/revert' },
  { method: 'DELETE', path: '/api/tools/:id' },
  { method: 'POST', path: '/api/tools/:id/run' },
];

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
      .handle('listForAi', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
          logger,
          requestId,
        );
      })
      .handle('listForGroup', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
          logger,
          requestId,
        );
      })
      // T-0110: the tools of one topic. Anyone who can see the topic reads;
      // anyone else gets the same 404 as a missing id.
      .handle('listForTopic', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
          logger,
          requestId,
        );
      })
      .handle('detail', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const tool = yield* Effect.promise(() =>
              requireReadableTool(deps.db, request.params.id, user.id),
            );
            return toDetailWire(tool);
          }),
          logger,
          requestId,
        );
      })
      .handle('versions', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const versions = yield* Effect.promise(() =>
              requireReadableVersions(deps.db, request.params.id, user.id),
            );
            return versions.map(toVersionListWire);
          }),
          logger,
          requestId,
        );
      })
      .handle('version', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const version = yield* Effect.promise(() =>
              requireReadableVersion(deps.db, request.params.id, request.params.n, user.id),
            );
            return toVersionDetailWire(version);
          }),
          logger,
          requestId,
        );
      })
      .handle('runs', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const runs = yield* Effect.promise(() =>
              requireReadableRuns(deps.db, request.params.id, user.id),
            );
            return runs.map(toRunListWire);
          }),
          logger,
          requestId,
        );
      })
      .handle('revert', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const body = yield* readJsonBody(request.request);
            if (!body.parsed) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const decoded = Schema.decodeUnknownOption(RevertBody, STRICT_DECODE)(body.value);
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
          logger,
          requestId,
        );
      })
      .handle('remove', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
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
            return HttpServerResponse.empty({ status: 204 });
          }),
          logger,
          requestId,
        );
      })
      .handle('run', (request) => {
        const requestId = requestIdOf(request.request);
        return withErrorEnvelope(
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const body = yield* readJsonBody(request.request);
            if (!body.parsed) {
              throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
            }
            const decoded = Schema.decodeUnknownOption(RunBody, STRICT_DECODE)(body.value);
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
          logger,
          requestId,
        );
      }),
  );

  const apiLayer = HttpApiBuilder.layer(ToolsApi).pipe(
    Layer.provide(groupLayer),
    Layer.provide(sessionLayer(deps.auth, logger)),
    Layer.provide(schemaErrorLayer(logger)),
  );

  // Hono keeps the request log (redacted path); the router's own logger prints
  // full URLs, so it stays off. Failures are logged by the envelope instead.
  const { handler } = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  );

  return { handler, routes: TOOLS_API_ROUTES };
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
