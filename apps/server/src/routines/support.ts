// The routine mutations (create, pause, resume, delete) and their result types.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { enforceRoutineLimit, toPublicRoutine } from './queries';
import { nextRunAfter, parseRoutineSchedule } from './schedule';
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
  const nextRunAt = nextRunAfter(schedule.value, now);
  let inserted: RoutineRow | null;
  try {
    inserted = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // jsonb is written as a cast string, or NULL when there is no input.
        const routineInput =
          input.input === undefined || input.input === null
            ? sql`NULL`
            : sql`${JSON.stringify(input.input)}::jsonb`;
        const [row] = yield* sql<RoutineRow>`INSERT INTO routines (
            id, ai_id, group_id, topic_id, tool_id, title, schedule, input,
            alert_card_id, alert_block_id, approved_hosts, status, paused_reason,
            next_run_at, last_run_at, last_status, consecutive_failures,
            created_by, created_at, updated_at, deleted_at
          ) VALUES (
            ${randomUUID()}, ${input.aiId}, ${input.groupId}, ${input.topicId},
            ${tool.id}, ${title}, ${JSON.stringify(schedule.value)}::jsonb,
            ${routineInput}, ${input.alertCard?.cardId ?? null},
            ${input.alertCard?.blockId ?? null},
            ${JSON.stringify(approved)}::jsonb, 'active', NULL,
            ${nextRunAt.toISOString()}, NULL, NULL, 0, ${input.userId},
            ${now.toISOString()}, ${now.toISOString()}, NULL
          )
          RETURNING *`;
        return row ?? null;
      }),
    );
  } catch (error) {
    // The partial unique index refused a second live routine; nothing was inserted and no audit written.
    if (isUniqueViolation(error)) {
      throw new RoutineServiceError(
        'alert_card_taken',
        'That alert card already drives another routine',
      );
    }
    throw error;
  }
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
      detail: { toolId: tool.id, ...(input.alertCard === undefined ? {} : { alertCard: true }) },
    });
  }
  return toPublicRoutine(inserted, tool.name, schedule.value);
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
    const row = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [found] = yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
        return found ?? null;
      }),
    );
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

// `needs_approval` answers 409; a `failures` pause resumes with the counter reset and `next_run_at` from now.
export async function resumeRoutine(
  db: ServerDatabase,
  id: string,
  actorId: string,
  now: Date,
  audit?: AuditRecorder,
): Promise<ResumeRoutineResult> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${id} LIMIT 1`;
      return found ?? null;
    }),
  );
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

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
