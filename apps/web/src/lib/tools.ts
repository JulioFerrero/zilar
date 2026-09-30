// T-0107: tools and routines read model + mutations for the web UI.
// The wire contract lives in apps/server/src/tools/routes.ts and
// apps/server/src/routines/routes.ts. Dates arrive as ISO strings and stay
// strings, like the approvals and audit schemas in api.ts.

import { z } from 'zod';
import { ApiError } from '@/lib/api';
import { isMockApiEnabled } from '@/mock/gate';
import { mockRequest } from '@/mock/api';

// --- Tools ---------------------------------------------------------------

export const toolListItemSchema = z.object({
  id: z.string(),
  aiId: z.string(),
  groupId: z.string().nullable(),
  topicId: z.string().nullable(),
  name: z.string(),
  description: z.string(),
  currentVersion: z.number(),
  hosts: z.array(z.string()),
  // T-0132: the human-approved host set (default in the server detail
  // payload too). Older payloads omit it; treated as none approved.
  approvedHosts: z.array(z.string()).optional(),
  lastRunStatus: z.enum(['ok', 'error']).nullable(),
  updatedAt: z.string(),
  scope: z.enum(['personal', 'group']).optional(),
});

export type ToolListItem = z.infer<typeof toolListItemSchema>;

export const toolDetailSchema = toolListItemSchema.extend({
  source: z.string(),
});

export type ToolDetail = z.infer<typeof toolDetailSchema>;

export const toolVersionSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  version: z.number(),
  message: z.string(),
  hosts: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.string(),
  toolName: z.string().optional(),
});

export type ToolVersion = z.infer<typeof toolVersionSchema>;

export const toolVersionDetailSchema = toolVersionSchema.extend({
  source: z.string(),
});

export type ToolVersionDetail = z.infer<typeof toolVersionDetailSchema>;

export const toolRunSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  version: z.number(),
  trigger: z.enum(['manual', 'routine', 'ai']),
  status: z.enum(['ok', 'error']),
  errorKind: z.string().nullable(),
  durationMs: z.number(),
  fetchCount: z.number(),
  outputText: z.string().nullable(),
  createdAt: z.string(),
});

export type ToolRun = z.infer<typeof toolRunSchema>;

const toolRunResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    output: z.object({ text: z.string(), data: z.unknown().optional() }),
    logs: z.string(),
    durationMs: z.number(),
    fetchCount: z.number(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ kind: z.string(), message: z.string() }),
    logs: z.string(),
    durationMs: z.number(),
    fetchCount: z.number(),
  }),
]);

export type ToolRunResult = z.infer<typeof toolRunResultSchema>;

// The web `request()` is private inside `lib/api.ts`, so small helpers here
// reuse this file-local copy with the same semantics (mock mode in
// `api.ts` stays out of unit tests; component tests stub `fetch`).

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
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
    const parsed = errorBodySchema.safeParse(raw);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'request_failed',
      parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return parsed.data;
}

/** Tools of one topic (anyone who can see the topic reads; else 404). */
export function listTopicToolDetails(topicId: string): Promise<ToolListItem[]> {
  return request(`/topics/${encodeURIComponent(topicId)}/tools`, z.array(toolListItemSchema));
}

/** Tools of one group (any member; only topics the viewer can see). */
export function listGroupToolDetails(groupId: string): Promise<ToolListItem[]> {
  return request(`/groups/${encodeURIComponent(groupId)}/tools`, z.array(toolListItemSchema));
}

/** Tools of one AI (the AI owner; with scope). */
export function listAiToolDetails(aiId: string): Promise<ToolListItem[]> {
  return request(`/ais/${encodeURIComponent(aiId)}/tools`, z.array(toolListItemSchema));
}

/** One tool with its current source. */
export function getToolDetail(id: string): Promise<ToolDetail> {
  return request(`/tools/${encodeURIComponent(id)}`, toolDetailSchema);
}

/** Version history of one tool, newest first, without source. */
export function listToolVersions(id: string): Promise<ToolVersion[]> {
  return request(`/tools/${encodeURIComponent(id)}/versions`, z.array(toolVersionSchema));
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
  return request(`/tools/${encodeURIComponent(id)}/runs`, z.array(toolRunSchema));
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
  await request(`/tools/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}

// --- Routines ------------------------------------------------------------

export const routineSchema = z.object({
  id: z.string(),
  aiId: z.string().optional(),
  groupId: z.string().nullable().optional(),
  topicId: z.string().nullable().optional(),
  toolId: z.string().optional(),
  title: z.string(),
  toolName: z.string(),
  schedule: z.unknown(),
  status: z.enum(['active', 'paused', 'needs_approval']),
  pausedReason: z.enum(['user', 'failures', 'hosts_changed']).nullable(),
  nextRunAt: z.string(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.enum(['ok', 'error', 'skipped']).nullable(),
  approvedHosts: z.array(z.string()),
  scope: z.enum(['personal', 'group']).optional(),
});

export type Routine = z.infer<typeof routineSchema>;

/** Routines of one AI (the AI owner; every topic, with scope). */
export function listAiRoutines(aiId: string): Promise<Routine[]> {
  return request(`/ais/${encodeURIComponent(aiId)}/routines`, z.array(routineSchema));
}

/** Routines of one group (any member; only topics the viewer can see). */
export function listGroupRoutines(groupId: string): Promise<Routine[]> {
  return request(`/groups/${encodeURIComponent(groupId)}/routines`, z.array(routineSchema));
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
  await request(`/routines/${encodeURIComponent(id)}`, z.null(), { method: 'DELETE' });
}
