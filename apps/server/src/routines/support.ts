// The routine mutations (create, pause, resume, delete) and their result types.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { safeStringify } from '../actions/support';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { enforceRoutineLimit, toPublicRoutine } from './queries';
import { nextRunAfter, parseRoutineSchedule, type RoutineSchedule } from './schedule';
import {
  MAX_ROUTINE_INPUT_BYTES,
  RoutineServiceError,
  parseRoutineTitle,
  type CreateRoutineInput,
  type DeleteRoutineResult,
  type PauseRoutineResult,
  type PublicRoutine,
  type ResumeRoutineResult,
  type RoutineToolRow,
  type RoutineVersionRow,
} from './schemas';

// Creates a routine after a human approved it: validates title, schedule and input, checks the tool belongs to the same (AI, topic).
// Requires `approvedHosts` to cover the tool's hosts and to sit inside the tool's approved set; enforces the 10-routines limit and audits ids only.
export async function createRoutine(
  db: ServerDatabase,
  input: CreateRoutineInput,
  now: Date,
  audit?: AuditRecorder,
): Promise<PublicRoutine> {
  const { title, schedule } = parseRoutineBasics(input);
  if (input.input !== undefined && input.input !== null) {
    const serialised = safeStringify(input.input);
    if (serialised === null || Buffer.byteLength(serialised, 'utf8') > MAX_ROUTINE_INPUT_BYTES) {
      throw new RoutineServiceError(
        'invalid_request',
        `input must serialise to at most ${MAX_ROUTINE_INPUT_BYTES} bytes`,
      );
    }
  }
  const tool = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<RoutineToolRow>`SELECT id, ai_id, group_id, topic_id, name,
          current_version, approved_hosts, deleted_at
        FROM ai_tools WHERE id = ${input.toolId} LIMIT 1`;
      return row ?? null;
    }),
  );
  if (
    !tool ||
    tool.deletedAt !== null ||
    tool.aiId !== input.aiId ||
    (tool.groupId ?? null) !== input.groupId ||
    (tool.topicId ?? null) !== input.topicId
  ) {
    throw new RoutineServiceError('invalid_request', 'The tool does not belong to this chat');
  }
  const version = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<RoutineVersionRow>`SELECT hosts FROM ai_tool_versions
        WHERE tool_id = ${tool.id} AND version = ${tool.currentVersion} LIMIT 1`;
      return row ?? null;
    }),
  );
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
  // A routine can never reach a host the tool itself may not contact; the adapter checks first, this is defence in depth.
  const toolApproved = new Set(tool.approvedHosts ?? []);
  if (!approved.every((host) => toolApproved.has(host))) {
    throw new RoutineServiceError(
      'tool_hosts_not_approved',
      'The tool hosts are not approved yet; run tool.approve_hosts first',
    );
  }
  await enforceRoutineLimit(db, input.aiId, input.topicId);
  const nextRunAt = nextRunAfter(schedule, now);
  const inserted = await insertRoutineRow(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // jsonb is written as a cast string, or NULL when there is no input.
      const routineInput =
        input.input === undefined || input.input === null
          ? sql`NULL`
          : sql`${JSON.stringify(input.input)}::jsonb`;
      return yield* sql<RoutineRow>`INSERT INTO routines (
            id, ai_id, group_id, topic_id, tool_id, title, schedule, input,
            alert_card_id, alert_block_id, approved_hosts, status, paused_reason,
            next_run_at, last_run_at, last_status, consecutive_failures,
            created_by, created_at, updated_at, deleted_at
          ) VALUES (
            ${randomUUID()}, ${input.aiId}, ${input.groupId}, ${input.topicId},
            ${tool.id}, ${title}, ${JSON.stringify(schedule)}::jsonb,
            ${routineInput}, ${input.alertCard?.cardId ?? null},
            ${input.alertCard?.blockId ?? null},
            ${JSON.stringify(approved)}::jsonb, 'active', NULL,
            ${nextRunAt.toISOString()}, NULL, NULL, 0, ${input.userId},
            ${now.toISOString()}, ${now.toISOString()}, NULL
          )
          RETURNING *`;
    }),
    'Failed to create routine',
  );
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
      detail: { toolId: tool.id, ...(input.alertCard === undefined ? {} : { alertCard: true }) },
    });
  }
  return toPublicRoutine(inserted, tool.name, schedule);
}

async function findRoutineRow(db: ServerDatabase, id: string): Promise<RoutineRow | null> {
  const [found] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
    }),
  );
  return found ?? null;
}

async function recordRoutineAudit(
  audit: AuditRecorder | undefined,
  actorId: string,
  routine: RoutineRow,
  action: string,
  detail: Record<string, unknown> | null,
): Promise<void> {
  if (audit === undefined) {
    return;
  }
  await audit.record({
    actorUserId: actorId,
    aiId: routine.aiId,
    groupId: routine.groupId,
    action,
    subjectId: routine.id,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail,
  });
}

// Pauses an active routine; an already paused one returns `paused: false` and writes nothing.
export async function pauseRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<PauseRoutineResult> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<RoutineRow>`UPDATE routines
        SET status = 'paused', paused_reason = 'user', updated_at = ${now.toISOString()}
        WHERE id = ${id} AND status = 'active' AND deleted_at IS NULL
        RETURNING *`;
      return row ?? null;
    }),
  );
  if (!updated) {
    const row = await findRoutineRow(db, id);
    if (!row || row.deletedAt !== null) {
      throw new RoutineServiceError('not_found', 'Routine not found');
    }
    return { routine: row, paused: false };
  }
  await recordRoutineAudit(audit, actorId, updated, 'routine.paused', { reason: 'user' });
  return { routine: updated, paused: true };
}

// `needs_approval` answers 409; a `failures` pause resumes with the counter reset and `next_run_at` from now.
export async function resumeRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<ResumeRoutineResult> {
  const row = await findRoutineRow(db, id);
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
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [result] = yield* sql<RoutineRow>`UPDATE routines
        SET status = 'active', paused_reason = NULL, consecutive_failures = 0,
            next_run_at = ${nextRunAfter(schedule.value, now).toISOString()},
            updated_at = ${now.toISOString()}
        WHERE id = ${id} AND status = 'paused' AND deleted_at IS NULL
        RETURNING *`;
      return result ?? null;
    }),
  );
  if (!updated) {
    throw new RoutineServiceError('not_found', 'Routine not found');
  }
  await recordRoutineAudit(audit, actorId, updated, 'routine.resumed', null);
  return { routine: updated, resumed: true };
}

// Idempotent: a missing or already deleted routine returns `deleted: false` and writes nothing.
export async function deleteRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<DeleteRoutineResult> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<RoutineRow>`UPDATE routines
        SET deleted_at = ${now.toISOString()}, updated_at = ${now.toISOString()}
        WHERE id = ${id} AND deleted_at IS NULL
        RETURNING *`;
      return row ?? null;
    }),
  );
  if (!updated) {
    return { deleted: false };
  }
  await recordRoutineAudit(audit, actorId, updated, 'routine.deleted', null);
  return { deleted: true };
}

// Both routine kinds validate the chat pair, title and schedule the same way.
export function parseRoutineBasics(input: {
  groupId: string | null;
  topicId: string | null;
  title: string;
  schedule: unknown;
}): { title: string; schedule: RoutineSchedule } {
  if ((input.groupId === null) !== (input.topicId === null)) {
    throw new RoutineServiceError(
      'invalid_request',
      'groupId and topicId must both be set or both be null',
    );
  }
  const title = parseRoutineTitle(input.title);
  const schedule = parseRoutineSchedule(input.schedule);
  if (!schedule.ok) {
    throw new RoutineServiceError('invalid_request', schedule.message);
  }
  return { title, schedule: schedule.value };
}

// Inserts one routine row; a refused alert-card index writes nothing and answers the same error for both kinds.
export async function insertRoutineRow(
  db: ServerDatabase,
  insert: Effect.Effect<ReadonlyArray<RoutineRow>, SqlError.SqlError, SqlClient.SqlClient>,
  failureMessage: string,
): Promise<RoutineRow> {
  let rows: ReadonlyArray<RoutineRow>;
  try {
    rows = await runSql(db, insert);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw new RoutineServiceError(
      'alert_card_taken',
      'That alert card already drives another routine',
    );
  }
  const [inserted] = rows;
  if (inserted === undefined) throw new Error(failureMessage);
  return inserted;
}
