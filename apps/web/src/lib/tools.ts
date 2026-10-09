// T-0107: tools and routines read model + mutations for the web UI.
// The wire contract lives in apps/server/src/tools/api.ts and
// apps/server/src/routines/api.ts. Dates arrive as ISO strings and stay
// strings, like the approvals and audit schemas in api.ts.

import { Result, Schema } from 'effect';
import { struct } from '@zilar/protocol';
import { ApiError } from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest } from '@/mock/api';

// --- Tools ---------------------------------------------------------------

export const toolListItemSchema = struct({
  id: Schema.String,
  aiId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  topicId: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.String,
  currentVersion: Schema.Number,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  // T-0132: the human-approved host set (default in the server detail
  // payload too). Older payloads omit it; treated as none approved.
  approvedHosts: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  lastRunStatus: Schema.NullOr(Schema.Literals(['ok', 'error'])),
  updatedAt: Schema.String,
  scope: Schema.optional(Schema.Literals(['personal', 'group'])),
});

export type ToolListItem = typeof toolListItemSchema.Type;

export const toolDetailSchema = struct({
  ...toolListItemSchema.fields,
  source: Schema.String,
});

export type ToolDetail = typeof toolDetailSchema.Type;

export const toolVersionSchema = struct({
  id: Schema.String,
  toolId: Schema.String,
  version: Schema.Number,
  message: Schema.String,
  hosts: Schema.mutable(Schema.Array(Schema.String)),
  createdBy: Schema.String,
  createdAt: Schema.String,
  toolName: Schema.optional(Schema.String),
});

export type ToolVersion = typeof toolVersionSchema.Type;

export const toolVersionDetailSchema = struct({
  ...toolVersionSchema.fields,
  source: Schema.String,
});

export type ToolVersionDetail = typeof toolVersionDetailSchema.Type;

export const toolRunSchema = struct({
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

export type ToolRun = typeof toolRunSchema.Type;

const toolRunResultSchema = Schema.Union([
  struct({
    ok: Schema.Literal(true),
    output: struct({ text: Schema.String, data: Schema.optional(Schema.Unknown) }),
    logs: Schema.String,
    durationMs: Schema.Number,
    fetchCount: Schema.Number,
  }),
  struct({
    ok: Schema.Literal(false),
    error: struct({ kind: Schema.String, message: Schema.String }),
    logs: Schema.String,
    durationMs: Schema.Number,
    fetchCount: Schema.Number,
  }),
]);

export type ToolRunResult = typeof toolRunResultSchema.Type;

// The web `request()` is private inside `lib/api.ts`, so small helpers here
// reuse this file-local copy with the same semantics (mock mode in
// `api.ts` stays out of unit tests; component tests stub `fetch`).

const errorBodySchema = struct({
  error: struct({ code: Schema.String, message: Schema.String }),
});

async function request<T>(
  path: string,
  schema: Schema.ConstraintDecoder<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  if (isMockApiEnabled()) {
    // Standalone mock mode: answer locally, never touch the network (T-0069).
    response = await mockRequest(path, init);
  } else {
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }
      response = await fetch(`/api${path}`, {
        credentials: 'same-origin',
        ...init,
        headers,
      });
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
  }

  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = Schema.decodeUnknownResult(errorBodySchema)(raw);
    throw new ApiError(
      response.status,
      Result.isSuccess(parsed) ? parsed.success.error.code : 'request_failed',
      Result.isSuccess(parsed)
        ? parsed.success.error.message
        : `Request failed (${response.status})`,
    );
  }

  const parsed = Schema.decodeUnknownResult(schema)(raw);
  if (!Result.isSuccess(parsed)) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.success;
}

/** Tools of one topic (anyone who can see the topic reads; else 404). */
export function listTopicToolDetails(topicId: string): Promise<ToolListItem[]> {
  return request(
    `/topics/${encodeURIComponent(topicId)}/tools`,
    Schema.mutable(Schema.Array(toolListItemSchema)),
  );
}

/** Tools of one group (any member; only topics the viewer can see). */
export function listGroupToolDetails(groupId: string): Promise<ToolListItem[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/tools`,
    Schema.mutable(Schema.Array(toolListItemSchema)),
  );
}

/** Tools of one AI (the AI owner; with scope). */
export function listAiToolDetails(aiId: string): Promise<ToolListItem[]> {
  return request(
    `/ais/${encodeURIComponent(aiId)}/tools`,
    Schema.mutable(Schema.Array(toolListItemSchema)),
  );
}

/** One tool with its current source. */
export function getToolDetail(id: string): Promise<ToolDetail> {
  return request(`/tools/${encodeURIComponent(id)}`, toolDetailSchema);
}

/** Version history of one tool, newest first, without source. */
export function listToolVersions(id: string): Promise<ToolVersion[]> {
  return request(
    `/tools/${encodeURIComponent(id)}/versions`,
    Schema.mutable(Schema.Array(toolVersionSchema)),
  );
}

/** One version with its source. */
export function getToolVersion(id: string, version: number): Promise<ToolVersionDetail> {
  return request(
    `/tools/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}`,
    toolVersionDetailSchema,
  );
}

/** Recent runs of one tool, newest first (never another chat's output: the server decides). */
export function listToolRuns(id: string): Promise<ToolRun[]> {
  return request(
    `/tools/${encodeURIComponent(id)}/runs`,
    Schema.mutable(Schema.Array(toolRunSchema)),
  );
}

/** Append a new version copying an older version's source and hosts. */
export function revertTool(id: string, version: number): Promise<ToolVersion> {
  return request(`/tools/${encodeURIComponent(id)}/revert`, toolVersionSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
}

/**
 * Run the current version now. `input` must serialise to at most 16 KiB
 * (the server answers 400 `invalid_request` above that, like the adapter).
 * Manager only; the server answers 404 for a viewer who may not run it.
 */
export function runToolNow(id: string, input?: unknown): Promise<ToolRunResult> {
  return request(`/tools/${encodeURIComponent(id)}/run`, toolRunResultSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input === undefined ? {} : { input }),
  });
}

export async function deleteTool(id: string): Promise<void> {
  await request(`/tools/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
}

// --- Routines ------------------------------------------------------------

export const routineSchema = struct({
  id: Schema.String,
  aiId: Schema.optional(Schema.String),
  groupId: Schema.optional(Schema.NullOr(Schema.String)),
  topicId: Schema.optional(Schema.NullOr(Schema.String)),
  toolId: Schema.optional(Schema.String),
  title: Schema.String,
  toolName: Schema.String,
  schedule: Schema.Unknown,
  status: Schema.Literals(['active', 'paused', 'needs_approval']),
  pausedReason: Schema.NullOr(Schema.Literals(['user', 'failures', 'hosts_changed'])),
  nextRunAt: Schema.String,
  lastRunAt: Schema.NullOr(Schema.String),
  lastStatus: Schema.NullOr(Schema.Literals(['ok', 'error', 'skipped'])),
  approvedHosts: Schema.mutable(Schema.Array(Schema.String)),
  scope: Schema.optional(Schema.Literals(['personal', 'group'])),
});

export type Routine = typeof routineSchema.Type;

/** Routines of one AI (the AI owner; every topic, with scope). */
export function listAiRoutines(aiId: string): Promise<Routine[]> {
  return request(
    `/ais/${encodeURIComponent(aiId)}/routines`,
    Schema.mutable(Schema.Array(routineSchema)),
  );
}

/** Routines of one group (any member; only topics the viewer can see). */
export function listGroupRoutines(groupId: string): Promise<Routine[]> {
  return request(
    `/groups/${encodeURIComponent(groupId)}/routines`,
    Schema.mutable(Schema.Array(routineSchema)),
  );
}

/** Pause a routine (manager; idempotent). */
export function pauseRoutine(id: string): Promise<Routine> {
  return request(`/routines/${encodeURIComponent(id)}/pause`, routineSchema, { method: 'POST' });
}

/**
 * Resume a paused routine (manager). A routine paused for hosts_changed
 * or awaiting re-approval answers 409 `needs_approval`.
 */
export function resumeRoutine(id: string): Promise<Routine> {
  return request(`/routines/${encodeURIComponent(id)}/resume`, routineSchema, { method: 'POST' });
}

/** Delete a routine (manager, idempotent). */
export async function deleteRoutine(id: string): Promise<void> {
  await request(`/routines/${encodeURIComponent(id)}`, Schema.Null, { method: 'DELETE' });
}
