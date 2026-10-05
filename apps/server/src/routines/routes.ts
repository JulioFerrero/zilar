// T-0104: routine HTTP routes, mounted in `app.ts` under `/api`.
//
// Access model (T-0110 topic rules, same 404 shape as the tools routes):
// reader = the AI's owner, or (for a topic routine) anyone who can see
// the topic; manager = the AI's owner, or a group owner/admin who can
// see the topic. Anyone else gets the same 404 as a missing id.
//
// - `GET /api/ais/:id/routines` (AI owner; every topic, with `scope`)
// - `GET /api/groups/:id/routines` (any group member; only topics the
//   viewer can see)
// - `POST /api/routines/:id/pause` (manager)
// - `POST /api/routines/:id/resume` (manager; 409 `needs_approval` when
//   the routine needs re-approval)
// - `DELETE /api/routines/:id` (manager, 204, idempotent)
//
// Rows never carry tool source: only the tool name.
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { Auth } from '../auth/auth';
import { requireSession } from '../auth/session';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, groupMembers, routines, topics } from '../db/schema';
import { HttpError } from '../errors';
import { canSeeTopic } from '../topics/access';
import {
  deleteRoutine,
  getRoutine,
  listRoutinesForAi,
  listRoutinesForTopic,
  pauseRoutine,
  resumeRoutine,
  RoutineServiceError,
  type PublicRoutine,
} from './service';

export interface RoutinesRoutesDependencies {
  auth: Auth;
  db: ServerDatabase;
  audit?: AuditRecorder;
  /** Injected in tests so pause/resume/delete timestamps can advance. */
  now?: () => Date;
}

export function createRoutinesRoutes({
  auth,
  db,
  audit,
  now = () => new Date(),
}: RoutinesRoutesDependencies): Hono {
  const routes = new Hono();

  routes.get('/ais/:id/routines', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const ai = await findOwnedAiRow(db, c.req.param('id'), user.id);
    if (!ai) {
      throw new HttpError(404, 'not_found', 'AI not found');
    }
    // Only routines of topics the owner can see: a routine in a private
    // topic the owner was removed from stays hidden until they are back.
    const all = await listRoutinesForAi(db, ai.id);
    const visible: PublicRoutine[] = [];
    for (const routine of all) {
      if (routine.topicId === null) {
        visible.push(routine);
        continue;
      }
      const [topic] = await db.select().from(topics).where(eq(topics.id, routine.topicId)).limit(1);
      if (topic && (await canSeeTopic(db, topic, user.id))) {
        visible.push(routine);
      }
    }
    return c.json(visible);
  });

  routes.get('/groups/:id/routines', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const groupId = c.req.param('id');
    const membership = await findMembership(db, groupId, user.id);
    if (!membership) {
      throw new HttpError(404, 'not_found', 'Group not found');
    }
    // Only routines of topics the viewer can see.
    const topicRows = await db.select().from(topics).where(eq(topics.groupId, groupId));
    const result: PublicRoutine[] = [];
    for (const topic of topicRows) {
      if (topic.archivedAt !== null) {
        continue;
      }
      if (!(await canSeeTopic(db, topic, user.id))) {
        continue;
      }
      const rows = await listRoutinesForTopic(db, topic.id);
      for (const routine of rows) {
        result.push(routine);
      }
    }
    return c.json(result);
  });

  routes.post('/routines/:id/pause', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const access = await routineAccess(db, c.req.param('id'), user.id);
    if (!access || !access.manager) {
      throw new HttpError(404, 'not_found', 'Routine not found');
    }
    try {
      await pauseRoutine(db, access.routine.id, user.id, now(), audit);
      const found = await getRoutine(db, access.routine.id);
      if (!found) {
        throw new HttpError(404, 'not_found', 'Routine not found');
      }
      return c.json(toWire(found.routine, found.toolName));
    } catch (error) {
      throw mapServiceError(error);
    }
  });

  routes.post('/routines/:id/resume', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const access = await routineAccess(db, c.req.param('id'), user.id);
    if (!access || !access.manager) {
      throw new HttpError(404, 'not_found', 'Routine not found');
    }
    try {
      await resumeRoutine(db, access.routine.id, user.id, now(), audit);
      const found = await getRoutine(db, access.routine.id);
      if (!found) {
        throw new HttpError(404, 'not_found', 'Routine not found');
      }
      return c.json(toWire(found.routine, found.toolName));
    } catch (error) {
      throw mapServiceError(error);
    }
  });

  routes.delete('/routines/:id', async (c) => {
    const { user } = await requireSession(auth, c.req.raw.headers);
    const routineId = c.req.param('id');
    // Like the tools delete: managers resolve on the raw row (including
    // soft-deleted ones) so a re-delete answers 204; strangers still get
    // the missing-id 404.
    const access = await routineAccessIncludingDeleted(db, routineId, user.id);
    if (!access || !access.manager) {
      throw new HttpError(404, 'not_found', 'Routine not found');
    }
    await deleteRoutine(db, routineId, user.id, now(), audit);
    return c.body(null, 204);
  });

  return routes;
}

interface RoutineAccess {
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null };
  manager: boolean;
}

// Reader = the AI's owner, or anyone who can see the topic. Manager =
// the AI's owner, or a group owner/admin who can see the topic. Null for
// a missing/deleted routine, a blind viewer, or a stranger (same shape
// for all, so existence is never leaked).
async function routineAccess(
  db: ServerDatabase,
  routineId: string,
  userId: string,
): Promise<RoutineAccess | null> {
  const found = await getRoutine(db, routineId);
  if (!found) {
    return null;
  }
  return accessFor(db, found.routine, userId);
}

// Same manager check on the raw row, including soft-deleted ones. Only
// the DELETE route uses this (idempotent 204).
async function routineAccessIncludingDeleted(
  db: ServerDatabase,
  routineId: string,
  userId: string,
): Promise<RoutineAccess | null> {
  const [row] = await db.select().from(routines).where(eq(routines.id, routineId)).limit(1);
  if (!row) {
    return null;
  }
  if (row.deletedAt !== null) {
    // A deleted routine reads as missing everywhere except the manager
    // check: resolve the manager on the row so a re-delete answers 204.
    return deletedAccessFor(db, row, userId);
  }
  return accessFor(db, row, userId);
}

async function accessFor(
  db: ServerDatabase,
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null },
  userId: string,
): Promise<RoutineAccess | null> {
  const [ai] = await db
    .select({ owner: ais.owner })
    .from(ais)
    .where(eq(ais.id, routine.aiId))
    .limit(1);
  if (!ai) {
    return null;
  }
  if (routine.topicId === null) {
    // Personal-chat routine: the AI owner only.
    return ai.owner === userId ? { routine, manager: true } : null;
  }
  const [topic] = await db.select().from(topics).where(eq(topics.id, routine.topicId)).limit(1);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  if (ai.owner === userId) {
    return { routine, manager: true };
  }
  const membership = await findMembership(db, routine.groupId as string, userId);
  if (!membership) {
    return null;
  }
  return { routine, manager: membership.role === 'owner' || membership.role === 'admin' };
}

async function deletedAccessFor(
  db: ServerDatabase,
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null },
  userId: string,
): Promise<RoutineAccess | null> {
  // A deleted row's topic may itself be gone; fall back to the group
  // membership alone so the manager check still resolves.
  const [ai] = await db
    .select({ owner: ais.owner })
    .from(ais)
    .where(eq(ais.id, routine.aiId))
    .limit(1);
  if (!ai) {
    return null;
  }
  if (ai.owner === userId) {
    return { routine, manager: true };
  }
  if (routine.groupId === null) {
    return null;
  }
  if (routine.topicId !== null) {
    const [topic] = await db.select().from(topics).where(eq(topics.id, routine.topicId)).limit(1);
    if (topic && !(await canSeeTopic(db, topic, userId))) {
      return null;
    }
  }
  const membership = await findMembership(db, routine.groupId, userId);
  if (!membership) {
    return null;
  }
  return { routine, manager: membership.role === 'owner' || membership.role === 'admin' };
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

function toWire(
  routine: {
    id: string;
    aiId: string;
    groupId: string | null;
    topicId: string | null;
    toolId: string;
    title: string;
    schedule: unknown;
    status: 'active' | 'paused' | 'needs_approval';
    pausedReason: 'user' | 'failures' | 'hosts_changed' | null;
    nextRunAt: Date;
    lastRunAt: Date | null;
    lastStatus: 'ok' | 'error' | 'skipped' | null;
    approvedHosts: string[];
  },
  toolName: string,
) {
  return {
    id: routine.id,
    title: routine.title,
    toolName,
    schedule: routine.schedule,
    status: routine.status,
    pausedReason: routine.pausedReason,
    nextRunAt: routine.nextRunAt,
    lastRunAt: routine.lastRunAt,
    lastStatus: routine.lastStatus,
    approvedHosts: routine.approvedHosts,
    scope: routine.groupId === null ? ('personal' as const) : ('group' as const),
  };
}

function mapServiceError(error: unknown): HttpError {
  if (error instanceof RoutineServiceError) {
    if (error.errorCode === 'not_found') {
      return new HttpError(404, 'not_found', 'Routine not found');
    }
    if (error.errorCode === 'needs_approval') {
      return new HttpError(409, 'needs_approval', error.message);
    }
    if (error.errorCode === 'routine_limit' || error.errorCode === 'hosts_not_approved') {
      return new HttpError(400, error.errorCode, error.message);
    }
    return new HttpError(400, 'invalid_request', error.message);
  }
  throw error;
}
