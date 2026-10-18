// Creates a `kind = 'prompt'` routine: no tool and no hosts.
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
  MAX_ROUTINE_PROMPT_CHARS,
  RoutineServiceError,
  parseRoutineTitle,
  type CreatePromptRoutineInput,
  type PublicRoutine,
} from './schemas';

// Validates title, schedule and prompt; enforces the same 10-per-topic limit as a tool routine and audits ids only.
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
  let inserted: RoutineRow | null;
  try {
    inserted = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* sql<RoutineRow>`INSERT INTO routines (
            id, ai_id, group_id, topic_id, kind, tool_id, prompt, title, schedule,
            input, alert_card_id, alert_block_id, approved_hosts, status,
            paused_reason, next_run_at, last_run_at, last_status,
            consecutive_failures, created_by, created_at, updated_at, deleted_at
          ) VALUES (
            ${randomUUID()}, ${input.aiId}, ${input.groupId}, ${input.topicId},
            'prompt', NULL, ${prompt}, ${title},
            ${JSON.stringify(schedule.value)}::jsonb, NULL,
            ${input.alertCard?.cardId ?? null}, ${input.alertCard?.blockId ?? null},
            '[]'::jsonb, 'active', NULL, ${nextRunAt.toISOString()}, NULL, NULL, 0,
            ${input.userId}, ${now.toISOString()}, ${now.toISOString()}, NULL
          )
          RETURNING *`;
        return row ?? null;
      }),
    );
  } catch (error) {
    // The partial unique index on the alert card block refused a second live routine; no audit is written.
    if (isUniqueViolation(error)) {
      throw new RoutineServiceError(
        'alert_card_taken',
        'That alert card already drives another routine',
      );
    }
    throw error;
  }
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
      detail: { kind: 'prompt', ...(input.alertCard === undefined ? {} : { alertCard: true }) },
    });
  }
  return toPublicRoutine(inserted, '', schedule.value);
}
