import { Hono } from 'hono';
import { z } from 'zod';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, aiTools, groupAis, groupMembers } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '../errors';
import { createRateLimiter } from '../rate-limit';
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
} from './service';

// Manual runs are capped per user per minute.
export const TOOL_RUN_RATE_LIMIT_MAX = 5;
export const TOOL_RUN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface ToolsRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Absent = no runner (T-0105 wires the sandbox): run answers 501. */
  toolRunner?: ToolRunner;
  /** Injected in tests so the rate-limit window can advance without waiting. */
  now?: () => number;
}

const revertBodySchema = z
  .object({
    version: z.number().int().min(1),
    message: z.string().min(1).max(200).optional(),
  })
  .strict();

const runBodySchema = z
  .object({
    input: z.unknown().optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict();

export function createToolsRoutes({
  auth,
  db,
  audit,
  toolRunner,
  now = Date.now,
}: ToolsRoutesDependencies): Hono {
  const routes = new Hono();
  const runLimiter = createRateLimiter({
    max: TOOL_RUN_RATE_LIMIT_MAX,
    windowMs: TOOL_RUN_RATE_LIMIT_WINDOW_MS,
    now,
  });

  routes.get('/ais/:id/tools', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ai = await findOwnedAiRow(db, c.req.param('id'), user.id);
    if (!ai) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    return c.json(await listToolsForAi(db, ai.id));
  });

  routes.get('/groups/:id/tools', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const groupId = c.req.param('id');
    const membership = await findMembership(db, groupId, user.id);
    if (!membership) {
      throw new HttpError(404, 'not_found', 'Group not found');
    }
    const tools = await listToolsForGroup(db, groupId);
    return c.json(tools);
  });

  routes.get('/tools/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const tool = await requireReadableTool(db, c.req.param('id'), user.id);
    return c.json(tool);
  });

  routes.get('/tools/:id/versions', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const versions = await requireReadableVersions(db, c.req.param('id'), user.id);
    return c.json(versions);
  });

  routes.get('/tools/:id/versions/:n', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const version = await requireReadableVersion(db, c.req.param('id'), c.req.param('n'), user.id);
    return c.json(version);
  });

  routes.get('/tools/:id/runs', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const runs = await requireReadableRuns(db, c.req.param('id'), user.id);
    return c.json(runs);
  });

  routes.post('/tools/:id/revert', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const parsed = revertBodySchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid revert body');
    }
    const toolId = c.req.param('id');
    const access = await toolAccess(db, toolId, user.id);
    if (!access || !access.manager) {
      throw new HttpError(404, 'not_found', 'Tool not found');
    }
    try {
      const nowDate = new Date(now());
      const { tool, version } = await revertTool(
        db,
        {
          toolId,
          toVersion: parsed.data.version,
          userId: user.id,
          ...(parsed.data.message === undefined ? null : { message: parsed.data.message }),
        },
        nowDate,
      );
      if (audit !== undefined) {
        await audit.record({
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
        });
      }
      return c.json(toVersionWire(tool, version));
    } catch (error) {
      throw mapServiceError(error);
    }
  });

  routes.delete('/tools/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const toolId = c.req.param('id');
    // `toolAccess` hides soft-deleted rows (they read as missing), but the
    // delete must be idempotent: a manager re-deleting sees 204, like the
    // approval-rule revoke. So managers are resolved on the raw row here,
    // including deleted ones; strangers still get the missing-id 404.
    const access = await toolAccessIncludingDeleted(db, toolId, user.id);
    if (!access || !access.manager) {
      throw new HttpError(404, 'not_found', 'Tool not found');
    }
    const { deleted } = await deleteTool(db, toolId, new Date(now()));
    if (deleted && audit !== undefined) {
      await audit.record({
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
      });
    }
    return c.body(null, 204);
  });

  routes.post('/tools/:id/run', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const parsed = runBodySchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', 'Invalid run body');
    }
    const toolId = c.req.param('id');
    const access = await toolAccess(db, toolId, user.id);
    if (!access || !access.manager) {
      throw new HttpError(404, 'not_found', 'Tool not found');
    }
    if (!runLimiter.allow(user.id)) {
      throw new HttpError(429, 'rate_limited', 'Too many tool runs, try again in a minute');
    }
    if (toolRunner === undefined) {
      throw new HttpError(501, 'runner_unavailable', 'No tool runner is configured on this server');
    }
    try {
      const { result, run } = await runToolVersion(
        { db, runner: toolRunner },
        {
          toolId,
          trigger: 'manual',
          ...(parsed.data.version === undefined ? null : { version: parsed.data.version }),
          ...(parsed.data.input === undefined ? null : { input: parsed.data.input }),
        },
        new Date(now()),
      );
      if (audit !== undefined) {
        await audit.record({
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
        });
      }
      return c.json(toRunWire(result));
    } catch (error) {
      throw mapServiceError(error);
    }
  });

  return routes;
}

// Reader = the AI's owner, or (for a group tool) any member of that group.
// Manager = the AI's owner, or (for a group tool) a group owner/admin.
// Returns null for a missing/deleted tool or a stranger (same shape for
// both, so existence is never leaked).
async function toolAccess(
  db: ServerDatabase,
  toolId: string,
  userId: string,
): Promise<{ tool: NonNullable<Awaited<ReturnType<typeof getTool>>>; manager: boolean } | null> {
  const tool = await getTool(db, toolId);
  if (!tool) {
    return null;
  }
  const [ai] = await db
    .select({ owner: ais.owner })
    .from(ais)
    .where(eq(ais.id, tool.aiId))
    .limit(1);
  if (!ai) {
    return null;
  }
  if (ai.owner === userId) {
    return { tool, manager: true };
  }
  if (tool.groupId === null) {
    return null;
  }
  const membership = await findMembership(db, tool.groupId, userId);
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
  tool: { aiId: string; groupId: string | null; name: string; currentVersion: number };
  manager: boolean;
} | null> {
  const [row] = await db
    .select({
      aiId: aiTools.aiId,
      groupId: aiTools.groupId,
      name: aiTools.name,
      currentVersion: aiTools.currentVersion,
    })
    .from(aiTools)
    .where(eq(aiTools.id, toolId))
    .limit(1);
  if (!row) {
    return null;
  }
  const [ai] = await db.select({ owner: ais.owner }).from(ais).where(eq(ais.id, row.aiId)).limit(1);
  if (!ai) {
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
  return toToolWire(access.tool);
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
  return {
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    source: version.source,
    hosts: version.hosts,
    message: version.message,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
  };
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
// scope. The caller is a member (checked by the route); the helper does
// not gate further.
async function listToolsForGroup(db: ServerDatabase, groupId: string) {
  const aiRows = await db
    .select({ aiId: groupAis.aiId })
    .from(groupAis)
    .where(eq(groupAis.groupId, groupId));
  const result: Array<Record<string, unknown>> = [];
  for (const { aiId } of aiRows) {
    const tools = await listTools(db, { aiId, groupId });
    for (const tool of tools) {
      result.push({ ...tool, scope: 'group' as const });
    }
  }
  return result;
}

async function findOwnedAiRow(db: ServerDatabase, aiId: string, ownerId: string) {
  const [row] = await db
    .select({ id: ais.id })
    .from(ais)
    .where(and(eq(ais.id, aiId), eq(ais.owner, ownerId)))
    .limit(1);
  return row ?? null;
}

async function findMembership(db: ServerDatabase, groupId: string, userId: string) {
  const [row] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

function toToolWire(tool: NonNullable<Awaited<ReturnType<typeof getTool>>>) {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    source: tool.source,
    hosts: tool.hosts,
    lastRunStatus: tool.lastRunStatus,
    updatedAt: tool.updatedAt,
    scope: tool.groupId === null ? ('personal' as const) : ('group' as const),
  };
}

function toVersionWire(
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
    hosts: version.hosts,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    toolName: tool.name,
  };
}

function toRunWire(result: Awaited<ReturnType<typeof runToolVersion>>['result']) {
  if (result.ok) {
    return {
      ok: true as const,
      output: result.output,
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

function mapServiceError(error: unknown): HttpError {
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
  throw error;
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_request', 'Invalid JSON body');
  }
}
