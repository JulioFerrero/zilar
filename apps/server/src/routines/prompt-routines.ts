// T-1641: creates a `kind = 'prompt'` routine (a scheduled prompt with no
// tool and no hosts). Nothing creates prompt routines until the chat action
// ships (plan task 6); only the chat action and these tests call this.
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { enforceRoutineLimit, toPublicRoutine } from './queries';
import { nextRunAfter, parseRoutineSchedule } from './schedule';
import {
  MAX_ROUTINE_PROMPT_CHARS,
  RoutineServiceError,
  parseRoutineTitle,
  type CreatePromptRoutineInput,
  type PublicRoutine,
} from './schemas';

// Creates a prompt routine after a human approved it. Validates the title,
// schedule and prompt; enforces the same 10-routines-per-topic limit as a
// tool routine; computes `next_run_at` from `now`; audits `routine.created`
// with ids only. The prompt text is never written to the audit.
export async function createPromptRoutine(
  db: ServerDatabase,
  input: CreatePromptRoutineInput,
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
  const prompt = input.prompt.trim();
  if (prompt.length < 1) {
    throw new RoutineServiceError('invalid_request', 'prompt must not be empty');
  }
  if (prompt.length > MAX_ROUTINE_PROMPT_CHARS) {
    throw new RoutineServiceError(
      'invalid_request',
      `prompt must be at most ${MAX_ROUTINE_PROMPT_CHARS} characters`,
    );
  }
  await enforceRoutineLimit(db, input.aiId, input.topicId);
  const nextRunAt = nextRunAfter(schedule.value, now);
  const inserted = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<RoutineRow>`INSERT INTO routines (
          id, ai_id, group_id, topic_id, kind, tool_id, prompt, title, schedule,
          input, approved_hosts, status, paused_reason, next_run_at, last_run_at,
          last_status, consecutive_failures, created_by, created_at, updated_at,
          deleted_at
        ) VALUES (
          ${randomUUID()}, ${input.aiId}, ${input.groupId}, ${input.topicId},
          'prompt', NULL, ${prompt}, ${title},
          ${JSON.stringify(schedule.value)}::jsonb, NULL, '[]'::jsonb, 'active',
          NULL, ${nextRunAt.toISOString()}, NULL, NULL, 0, ${input.userId},
          ${now.toISOString()}, ${now.toISOString()}, NULL
        )
        RETURNING *`;
      return row ?? null;
    }),
  );
  if (!inserted) {
    throw new Error('Failed to create prompt routine');
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
      detail: { kind: 'prompt' },
    });
  }
  return toPublicRoutine(inserted, '', schedule.value);
}
