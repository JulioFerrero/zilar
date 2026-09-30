// T-0104: routine service. A routine is a stored tool plus a schedule in
// one topic (T-0110 scope: `groupId` + `topicId`, or both null for the
// personal chat with the AI's owner), posting the tool's output as the AI.
// `createRoutine` is called by the T-0105 adapter after a human approved;
// this task exposes no HTTP route that creates a routine.
import { randomUUID } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { aiTools, aiToolVersions, routines } from '../db/schema';
import { nextRunAfter, parseRoutineSchedule, type RoutineSchedule } from './schedule';

export const MAX_ROUTINES_PER_TOPIC = 10;
export const MAX_ROUTINE_TITLE_CHARS = 80;
export const MAX_ROUTINE_INPUT_BYTES = 2 * 1024;

export class RoutineServiceError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = 'RoutineServiceError';
    this.errorCode = errorCode;
  }
}

export type RoutineStatus = 'active' | 'paused' | 'needs_approval';
export type RoutinePausedReason = 'user' | 'failures' | 'hosts_changed';
export type RoutineLastStatus = 'ok' | 'error' | 'skipped';

export type RoutineRow = typeof routines.$inferSelect;

export interface CreateRoutineInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  toolId: string;
  title: string;
  schedule: unknown;
  input?: unknown;
  approvedHosts: string[];
  userId: string;
}

export interface PublicRoutine {
  id: string;
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  toolId: string;
  toolName: string;
  title: string;
  schedule: RoutineSchedule;
  status: RoutineStatus;
  pausedReason: RoutinePausedReason | null;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: RoutineLastStatus | null;
  approvedHosts: string[];
  /** `personal` means the owner's DM with the AI; `group` a group topic. */
  scope: 'personal' | 'group';
}

const TITLE_CONTROL_CHARS = String.fromCharCode(
  ...Array.from({ length: 32 }, (_, index) => index),
  127,
);

const titleSchema = z
  .string()
  .min(1, { message: 'title must not be empty' })
  .max(MAX_ROUTINE_TITLE_CHARS, {
    message: `title must be at most ${MAX_ROUTINE_TITLE_CHARS} characters`,
  })
  .refine((value) => !value.split('').some((char) => TITLE_CONTROL_CHARS.includes(char)), {
    message: 'title must not contain control characters',
  });

// Creates a routine after a human approved it (the T-0105 adapter calls
// this). Validates the title, schedule and input; checks the tool belongs
// to the same (AI, topic) and is not deleted; requires `approvedHosts`
// to be a superset of the tool's current version hosts (otherwise
// `hosts_not_approved`); enforces the 10-routines limit; computes
// `next_run_at` from `now`; audits `routine.created` with ids only.
export async function createRoutine(
  db: ServerDatabase,
  input: CreateRoutineInput,
  now: Date,
  audit?: AuditRecorder,
): Promise<PublicRoutine> {
  if ((input.groupId === null) !== (input.topicId === null)) {
    throw new RoutineServiceError(
      'invalid_request',
      'groupId and topicId must both be set or both be null',
    );
  }
  const title = titleSchema.safeParse(input.title);
  if (!title.success) {
    throw new RoutineServiceError(
      'invalid_request',
      title.error.issues[0]?.message ?? 'Invalid title',
    );
  }
  const schedule = parseRoutineSchedule(input.schedule);
  if (!schedule.ok) {
    throw new RoutineServiceError('invalid_request', schedule.message);
  }
  if (input.input !== undefined && input.input !== null) {
    const serialised = safeStringify(input.input);
    if (serialised === null || Buffer.byteLength(serialised, 'utf8') > MAX_ROUTINE_INPUT_BYTES) {
      throw new RoutineServiceError(
        'invalid_request',
        `input must serialise to at most ${MAX_ROUTINE_INPUT_BYTES} bytes`,
      );
    }
  }
  const [tool] = await db
    .select({
      id: aiTools.id,
      aiId: aiTools.aiId,
      groupId: aiTools.groupId,
      topicId: aiTools.topicId,
      name: aiTools.name,
      currentVersion: aiTools.currentVersion,
      deletedAt: aiTools.deletedAt,
    })
    .from(aiTools)
    .where(eq(aiTools.id, input.toolId))
    .limit(1);
  if (
    !tool ||
    tool.deletedAt !== null ||
    tool.aiId !== input.aiId ||
    (tool.groupId ?? null) !== input.groupId ||
    (tool.topicId ?? null) !== input.topicId
  ) {
    throw new RoutineServiceError('invalid_request', 'The tool does not belong to this chat');
  }
  const [version] = await db
    .select({ hosts: aiToolVersions.hosts })
    .from(aiToolVersions)
    .where(and(eq(aiToolVersions.toolId, tool.id), eq(aiToolVersions.version, tool.currentVersion)))
    .limit(1);
  if (!version) {
    throw new RoutineServiceError('invalid_request', 'The tool has no current version');
  }
  const approved = [...new Set(input.approvedHosts.map((host) => host.toLowerCase()))];
  if (!version.hosts.every((host) => approved.includes(host))) {
    throw new RoutineServiceError(
      'hosts_not_approved',
      'The approved hosts must include every host the tool contacts',
    );
  }
  await enforceRoutineLimit(db, input.aiId, input.topicId);
  const nextRunAt = nextRunAfter(schedule.value, now);
  const [inserted] = await db
    .insert(routines)
    .values({
      id: randomUUID(),
      aiId: input.aiId,
      groupId: input.groupId,
      topicId: input.topicId,
      toolId: tool.id,
      title: title.data,
      schedule: schedule.value,
      input: input.input ?? null,
      approvedHosts: approved,
      status: 'active',
      pausedReason: null,
      nextRunAt,
      lastRunAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .returning();
  if (!inserted) {
    throw new Error('Failed to create routine');
  }
  if (audit !== undefined) {
    await audit.record({
      actorUserId: input.userId,
      aiId: input.aiId,
      groupId: input.groupId,
      action: 'routine.created',
      subjectId: inserted.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { toolId: tool.id },
    });
  }
  return toPublicRoutine(inserted, tool.name, schedule.value);
}

// One non-deleted routine, or null for a missing/deleted id.
export async function getRoutine(
  db: ServerDatabase,
  id: string,
): Promise<{ routine: RoutineRow; toolName: string } | null> {
  const [row] = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
  if (!row || row.deletedAt !== null) {
    return null;
  }
  const [tool] = await db
    .select({ name: aiTools.name })
    .from(aiTools)
    .where(eq(aiTools.id, row.toolId))
    .limit(1);
  const schedule = parseRoutineSchedule(row.schedule);
  if (!schedule.ok) {
    return null;
  }
  return { routine: row, toolName: tool?.name ?? '' };
}

// Every non-deleted routine of one AI, newest first, with the tool name.
export async function listRoutinesForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<PublicRoutine[]> {
  const rows = await db.select().from(routines).where(eq(routines.aiId, aiId));
  return toPublicRoutines(db, rows);
}

// Every non-deleted routine in one topic.
export async function listRoutinesForTopic(
  db: ServerDatabase,
  topicId: string,
): Promise<PublicRoutine[]> {
  const rows = await db.select().from(routines).where(eq(routines.topicId, topicId));
  return toPublicRoutines(db, rows);
}

export interface PauseRoutineResult {
  routine: RoutineRow;
  paused: boolean;
}

// Pauses an active routine (`paused_reason = 'user'`). Idempotent: an
// already paused (or `needs_approval`) routine returns `paused: false` and
// writes nothing. Audits `routine.paused` only when it actually paused.
export async function pauseRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<PauseRoutineResult> {
  const [updated] = await db
    .update(routines)
    .set({ status: 'paused', pausedReason: 'user', updatedAt: now })
    .where(and(eq(routines.id, id), eq(routines.status, 'active'), isNull(routines.deletedAt)))
    .returning();
  if (!updated) {
    const [row] = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
    if (!row || row.deletedAt !== null) {
      throw new RoutineServiceError('not_found', 'Routine not found');
    }
    return { routine: row, paused: false };
  }
  if (audit !== undefined) {
    await audit.record({
      actorUserId: actorId,
      aiId: updated.aiId,
      groupId: updated.groupId,
      action: 'routine.paused',
      subjectId: updated.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { reason: 'user' },
    });
  }
  return { routine: updated, paused: true };
}

export interface ResumeRoutineResult {
  routine: RoutineRow;
  resumed: boolean;
}

// Resumes a paused routine. `needs_approval` answers 409 `needs_approval`
// (a human must re-schedule it); a routine paused for `failures` resumes
// with `consecutive_failures = 0` and `next_run_at` recomputed from now.
// An active routine is a no-op. Audits `routine.resumed` on a real resume.
export async function resumeRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<ResumeRoutineResult> {
  const [row] = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
  if (!row || row.deletedAt !== null) {
    throw new RoutineServiceError('not_found', 'Routine not found');
  }
  if (row.status === 'needs_approval') {
    throw new RoutineServiceError(
      'needs_approval',
      'The routine needs re-approval before it can resume',
    );
  }
  if (row.status === 'active') {
    return { routine: row, resumed: false };
  }
  const schedule = parseRoutineSchedule(row.schedule);
  if (!schedule.ok) {
    throw new RoutineServiceError('invalid_request', schedule.message);
  }
  const [updated] = await db
    .update(routines)
    .set({
      status: 'active',
      pausedReason: null,
      consecutiveFailures: 0,
      nextRunAt: nextRunAfter(schedule.value, now),
      updatedAt: now,
    })
    .where(and(eq(routines.id, id), eq(routines.status, 'paused'), isNull(routines.deletedAt)))
    .returning();
  if (!updated) {
    throw new RoutineServiceError('not_found', 'Routine not found');
  }
  if (audit !== undefined) {
    await audit.record({
      actorUserId: actorId,
      aiId: updated.aiId,
      groupId: updated.groupId,
      action: 'routine.resumed',
      subjectId: updated.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
  }
  return { routine: updated, resumed: true };
}

export interface DeleteRoutineResult {
  deleted: boolean;
}

// Soft-deletes one routine. Idempotent: a missing id or an already
// deleted routine returns `deleted: false` and writes nothing. Audits
// `routine.deleted` on a real delete.
export async function deleteRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<DeleteRoutineResult> {
  const [updated] = await db
    .update(routines)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(routines.id, id), isNull(routines.deletedAt)))
    .returning();
  if (!updated) {
    return { deleted: false };
  }
  if (audit !== undefined) {
    await audit.record({
      actorUserId: actorId,
      aiId: updated.aiId,
      groupId: updated.groupId,
      action: 'routine.deleted',
      subjectId: updated.id,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: null,
    });
  }
  return { deleted: true };
}

// Soft-deletes every active routine of one AI in one topic. Takes the
// caller's transaction (topic-AI removal): deletes the routines there.
// Returns the deleted ids.
export async function deleteRoutinesForAiInTopic(
  tx: ServerDatabase,
  input: { aiId: string; topicId: string; now: Date },
): Promise<string[]> {
  const rows = await tx
    .update(routines)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(routines.aiId, input.aiId),
        eq(routines.topicId, input.topicId),
        isNull(routines.deletedAt),
      ),
    )
    .returning();
  return rows.map((row) => row.id);
}

// Soft-deletes every active routine of one AI in every topic of a group.
// Takes the caller's transaction (`removeGroupAi`): deletes the routines
// there. Returns the deleted ids.
export async function deleteRoutinesForAiInGroup(
  tx: ServerDatabase,
  input: { aiId: string; groupId: string; now: Date },
): Promise<string[]> {
  const rows = await tx
    .update(routines)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(routines.aiId, input.aiId),
        eq(routines.groupId, input.groupId),
        isNull(routines.deletedAt),
      ),
    )
    .returning();
  return rows.map((row) => row.id);
}

// Soft-deletes every active routine running one tool. Called from
// `deleteTool` in the same step. Returns the deleted ids.
export async function deleteRoutinesForTool(
  db: ServerDatabase,
  input: { toolId: string; now: Date },
): Promise<string[]> {
  const rows = await db
    .update(routines)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(and(eq(routines.toolId, input.toolId), isNull(routines.deletedAt)))
    .returning();
  return rows.map((row) => row.id);
}

async function enforceRoutineLimit(
  db: ServerDatabase,
  aiId: string,
  topicId: string | null,
): Promise<void> {
  const rows = await db
    .select({ total: count() })
    .from(routines)
    .where(
      topicId === null
        ? and(eq(routines.aiId, aiId), isNull(routines.topicId), isNull(routines.deletedAt))
        : and(eq(routines.aiId, aiId), eq(routines.topicId, topicId), isNull(routines.deletedAt)),
    );
  if (Number(rows[0]?.total ?? 0) >= MAX_ROUTINES_PER_TOPIC) {
    throw new RoutineServiceError(
      'routine_limit',
      `A topic has at most ${MAX_ROUTINES_PER_TOPIC} routines`,
    );
  }
}

async function toPublicRoutines(db: ServerDatabase, rows: RoutineRow[]): Promise<PublicRoutine[]> {
  const live = rows.filter((row) => row.deletedAt === null);
  const result: PublicRoutine[] = [];
  for (const row of live) {
    const schedule = parseRoutineSchedule(row.schedule);
    if (!schedule.ok) {
      continue;
    }
    const [tool] = await db
      .select({ name: aiTools.name })
      .from(aiTools)
      .where(eq(aiTools.id, row.toolId))
      .limit(1);
    result.push(toPublicRoutine(row, tool?.name ?? '', schedule.value));
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

function toPublicRoutine(
  row: RoutineRow,
  toolName: string,
  schedule: RoutineSchedule,
): PublicRoutine {
  return {
    id: row.id,
    aiId: row.aiId,
    groupId: row.groupId,
    topicId: row.topicId,
    toolId: row.toolId,
    toolName,
    title: row.title,
    schedule,
    status: row.status,
    pausedReason: row.pausedReason,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus,
    approvedHosts: [...row.approvedHosts],
    scope: row.groupId === null ? 'personal' : 'group',
  };
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
