// effect-plain: moved unchanged from apps/server/src/routines/api.ts (size split)

import type { ServerDatabase } from '../db/client';
import { canSeeTopic } from '../topics/access';
import { findAiOwner, findMembership, findRoutineById, findTopicById } from './reads';
import { getRoutine } from './service';

export interface RoutineAccess {
  routine: { id: string; aiId: string; groupId: string | null; topicId: string | null };
  manager: boolean;
}

// Reader = the AI's owner, or anyone who can see the topic. Manager =
// the AI's owner, or a group owner/admin who can see the topic. Null for
// a missing/deleted routine, a blind viewer, or a stranger (same shape
// for all, so existence is never leaked).
export async function routineAccess(
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
export async function routineAccessIncludingDeleted(
  db: ServerDatabase,
  routineId: string,
  userId: string,
): Promise<RoutineAccess | null> {
  const row = await findRoutineById(db, routineId);
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
  const ai = await findAiOwner(db, routine.aiId);
  if (!ai) {
    return null;
  }
  if (routine.topicId === null) {
    // Personal-chat routine: the AI owner only.
    return ai.owner === userId ? { routine, manager: true } : null;
  }
  const topic = await findTopicById(db, routine.topicId);
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
  const ai = await findAiOwner(db, routine.aiId);
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
    const topic = await findTopicById(db, routine.topicId);
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
