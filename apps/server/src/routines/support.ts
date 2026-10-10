// T-0984: size split of `routines/service.ts`. The routine mutations (create,
// pause, resume, delete) and their result types live here; the old path stays
// the barrel.
import { randomUUID } from 'node:crypto';
import { Effect, Exit, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { enforceRoutineLimit, toPublicRoutine } from './queries';
import { nextRunAfter, parseRoutineSchedule } from './schedule';
import {
  MAX_ROUTINE_INPUT_BYTES,
  RoutineServiceError,
  firstIssueMessage,
  titleSchema,
  type CreateRoutineInput,
  type DeleteRoutineResult,
  type PauseRoutineResult,
  type PublicRoutine,
  type ResumeRoutineResult,
  type RoutineToolRow,
  type RoutineVersionRow,
} from './schemas';

// Creates a routine after a human approved it (the T-0105 adapter calls
// this). Validates the title, schedule and input; checks the tool belongs
// to the same (AI, topic) and is not deleted; requires `approvedHosts`
// to be a superset of the tool's current version hosts (otherwise
// `hosts_not_approved`); T-0132 additionally requires every host in
// `approvedHosts` to be inside the TOOL's approved set (otherwise
// `tool_hosts_not_approved`, model told to run `tool.approve_hosts`);
// enforces the 10-routines limit; computes `next_run_at` from `now`;
// audits `routine.created` with ids only.
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
  const title = Schema.decodeUnknownExit(titleSchema)(input.title);
  if (!Exit.isSuccess(title)) {
    let message: string | undefined;
    for (const reason of title.cause.reasons) {
      if (reason._tag === 'Fail') {
        message = firstIssueMessage(reason.error.issue);
        break;
      }
    }
    throw new RoutineServiceError('invalid_request', message ?? 'Invalid title');
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
  // T-0132: the routine's card hosts must also sit inside the tool's
  // approved set, so a routine can never reach a host the tool itself may
  // not contact. (The adapter checks this first with a model-actionable
  // summary; this is the defence in depth for direct service callers.)
  const toolApproved = new Set(tool.approvedHosts ?? []);
  if (!approved.every((host) => toolApproved.has(host))) {
    throw new RoutineServiceError(
      'tool_hosts_not_approved',
      'The tool hosts are not approved yet; run tool.approve_hosts first',
    );
  }
  await enforceRoutineLimit(db, input.aiId, input.topicId);
  const nextRunAt = nextRunAfter(schedule.value, now);
  const inserted = await runSql(
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
          approved_hosts, status, paused_reason, next_run_at, last_run_at,
          last_status, consecutive_failures, created_by, created_at, updated_at,
          deleted_at
        ) VALUES (
          ${randomUUID()}, ${input.aiId}, ${input.groupId}, ${input.topicId},
          ${tool.id}, ${title.value}, ${JSON.stringify(schedule.value)}::jsonb,
          ${routineInput}, ${JSON.stringify(approved)}::jsonb, 'active', NULL,
          ${nextRunAt.toISOString()}, NULL, NULL, 0, ${input.userId},
          ${now.toISOString()}, ${now.toISOString()}, NULL
        )
        RETURNING *`;
      return row ?? null;
    }),
  );
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

// Soft-deletes every active routine of one AI in one topic. Called from
// topic-AI removal with the top-level `deps.db`. Returns the deleted ids.
export async function deleteRoutinesForAiInTopic(
  db: ServerDatabase,
  input: { aiId: string; topicId: string; now: Date },
): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE routines
        SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
        WHERE ai_id = ${input.aiId} AND topic_id = ${input.topicId} AND deleted_at IS NULL
        RETURNING id`;
    }),
  );
  return rows.map((row) => row.id);
}

// Soft-deletes every active routine of one AI in every topic of a group.
// Called from `removeGroupAi` inside its `sql.withTransaction`. Returns the
// deleted ids.
export function deleteRoutinesForAiInGroupEffect(input: {
  aiId: string;
  groupId: string;
  now: Date;
}): Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: string }>`UPDATE routines
      SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
      WHERE ai_id = ${input.aiId} AND group_id = ${input.groupId} AND deleted_at IS NULL
      RETURNING id`;
    return rows.map((row) => row.id);
  });
}

// Soft-deletes every active routine running one tool. Called from
// `deleteTool` in the same step. Returns the deleted ids.
export async function deleteRoutinesForTool(
  db: ServerDatabase,
  input: { toolId: string; now: Date },
): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE routines
        SET deleted_at = ${input.now.toISOString()}, updated_at = ${input.now.toISOString()}
        WHERE tool_id = ${input.toolId} AND deleted_at IS NULL
        RETURNING id`;
    }),
  );
  return rows.map((row) => row.id);
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
