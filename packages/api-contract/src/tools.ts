// Tools (T-0103 to T-0107): the small programs an AI owns, their versions and
// their runs. Dates travel as ISO strings and stay strings in the clients.
//
// The revert and run bodies are decoded by hand in the server handlers, so
// the order stays: session, then decode (400), then access (404), then the
// run limiter (429), then the runner check (501). The server therefore builds
// its `HttpApi` from `ToolsServerGroup`, whose `revert` and `run` declare no
// payload; the derived client uses `ToolsGroup`, whose two endpoints declare
// the payload, so the calls are typed and encoded on the client side.

import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api';
import { Session } from './middleware';
import { ToolsSchemaErrors } from './middleware-chain-b';

export const ToolListItem = Schema.Struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.String,
  currentVersion: Schema.Number,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  // T-0132: the human-approved host set. Older payloads omit it (none approved).
  approvedHosts: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  lastRunStatus: Schema.NullOr(Schema.Literals(['ok', 'error'])),
  updatedAt: Schema.String,
  scope: Schema.optional(Schema.Literals(['personal', 'group'])),
});

export type ToolListItem = typeof ToolListItem.Type;

/** The list shape plus the current source. */
export const ToolDetail = Schema.Struct({
  ...ToolListItem.fields,
  source: Schema.String,
});

export type ToolDetail = typeof ToolDetail.Type;

/** One version, without source. `toolName` is set on a revert's answer. */
export const ToolVersion = Schema.Struct({
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  message: Schema.String,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  createdBy: Schema.String,
  createdAt: Schema.String,
  toolName: Schema.optional(Schema.String),
});

export type ToolVersion = typeof ToolVersion.Type;

export const ToolVersionDetail = Schema.Struct({
  ...ToolVersion.fields,
  source: Schema.String,
});

export type ToolVersionDetail = typeof ToolVersionDetail.Type;

/** The output text is the stored (truncated) column, never the live run output. */
export const ToolRun = Schema.Struct({
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

export type ToolRun = typeof ToolRun.Type;

/**
 * The answer of a manual run (T-0219): the tool's own ok output or its own
 * failure. A failed run is still a 200, so this is data, not an error.
 */
export const ToolRunResult = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    output: Schema.Struct({ text: Schema.String, data: Schema.optional(Schema.Unknown) }),
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

export type ToolRunResult = typeof ToolRunResult.Type;

/** Strict: an excess key is a 400 (checked by the server's hand decode). */
export const RevertToolPayload = Schema.Struct({
  version: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  message: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
  ),
});

/**
 * Strict. `input` must serialise to at most 16 KiB; the server checks that
 * after the decode and answers 400 `invalid_request`.
 */
export const RunToolPayload = Schema.Struct({
  input: Schema.optional(Schema.Unknown),
  version: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))),
  ),
});

const ToolIdParams = Schema.Struct({ id: Schema.String });
const ToolVersionParams = Schema.Struct({ id: Schema.String, n: Schema.String });

const listForAi = HttpApiEndpoint.get('listForAi', '/ais/:id/tools', {
  params: ToolIdParams,
  success: Schema.Array(ToolListItem),
});

const listForGroup = HttpApiEndpoint.get('listForGroup', '/groups/:id/tools', {
  params: ToolIdParams,
  success: Schema.Array(ToolListItem),
});

const listForTopic = HttpApiEndpoint.get('listForTopic', '/topics/:id/tools', {
  params: ToolIdParams,
  success: Schema.Array(ToolListItem),
});

const detail = HttpApiEndpoint.get('detail', '/tools/:id', {
  params: ToolIdParams,
  success: ToolDetail,
});

const versions = HttpApiEndpoint.get('versions', '/tools/:id/versions', {
  params: ToolIdParams,
  success: Schema.Array(ToolVersion),
});

const version = HttpApiEndpoint.get('version', '/tools/:id/versions/:n', {
  params: ToolVersionParams,
  success: ToolVersionDetail,
});

const runs = HttpApiEndpoint.get('runs', '/tools/:id/runs', {
  params: ToolIdParams,
  success: Schema.Array(ToolRun),
});

const remove = HttpApiEndpoint.delete('remove', '/tools/:id', {
  params: ToolIdParams,
  success: HttpApiSchema.NoContent,
});

/** The group the derived clients use: `revert` and `run` carry their payloads. */
export const ToolsGroup = HttpApiGroup.make('tools')
  .add(
    listForAi,
    listForGroup,
    listForTopic,
    detail,
    versions,
    version,
    runs,
    HttpApiEndpoint.post('revert', '/tools/:id/revert', {
      params: ToolIdParams,
      payload: RevertToolPayload,
      success: ToolVersion,
    }),
    remove,
    HttpApiEndpoint.post('run', '/tools/:id/run', {
      params: ToolIdParams,
      payload: RunToolPayload,
      success: ToolRunResult,
    }),
  )
  .middleware(Session)
  .middleware(ToolsSchemaErrors)
  // The edge forwards the full request path, so the group keeps the `/api` prefix.
  .prefix('/api');

/** The group the server implements: `revert` and `run` decode their bodies by hand. */
export const ToolsServerGroup = HttpApiGroup.make('tools')
  .add(
    listForAi,
    listForGroup,
    listForTopic,
    detail,
    versions,
    version,
    runs,
    HttpApiEndpoint.post('revert', '/tools/:id/revert', {
      params: ToolIdParams,
      success: ToolVersion,
    }),
    remove,
    HttpApiEndpoint.post('run', '/tools/:id/run', {
      params: ToolIdParams,
      success: ToolRunResult,
    }),
  )
  .middleware(Session)
  .middleware(ToolsSchemaErrors)
  .prefix('/api');
