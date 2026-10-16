// T-1645: the prompt-routine path of a scheduled run. A prompt routine has
// no tool: it asks the AI gateway for one scheduled turn through the
// optional `runPrompt` port. Until that port is wired (a later task) it is
// absent in production, so every prompt routine is recorded `skipped`.
//
// A run takes one slot from a per-AI, per-UTC-day cap first
// (`routine_prompt_runs`, 24/day), atomically, so parallel schedulers cannot
// overshoot. Then it runs the prompt once through the port and records the
// outcome:
//   replied              -> ok
//   failed               -> the failure counter (the 3rd pauses)
//   stopped, limited,    -> skipped (nothing was posted; the AI or the
//   offline, not_in_room     room, not the routine, is the reason)
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { ExecuteRoutineOptions, ExecuteRoutinePorts } from './execute';
import { markOk, markSkipped, recordFailure } from './outcomes';

export type PromptRunOutcome =
  'replied' | 'failed' | 'stopped' | 'limited' | 'offline' | 'not_in_room';

// The AI gateway's scheduled turn, wired in a later task. Absent in
// production until then.
export type PromptRunner = (input: {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  routineId: string;
  title: string;
  prompt: string;
}) => Promise<PromptRunOutcome>;

// At most this many prompt runs per AI per UTC day. Scheduled work is
// valuable but a runaway routine must not burn the whole budget.
export const MAX_PROMPT_RUNS_PER_DAY = 24;

interface PromptRunCountRow {
  count: number;
}

// Takes one slot for the day of `at` (its UTC date). One statement, so two
// schedulers racing the same AI can never exceed the cap: the conflict path
// only increments while the stored count is still below it, and a row is
// returned only when a slot was taken.
export async function claimPromptRun(db: ServerDatabase, aiId: string, at: Date): Promise<boolean> {
  const day = at.toISOString().slice(0, 10);
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PromptRunCountRow>`INSERT INTO routine_prompt_runs (ai_id, day, count)
        VALUES (${aiId}, ${day}, 1)
        ON CONFLICT (ai_id, day) DO UPDATE SET count = routine_prompt_runs.count + 1
        WHERE routine_prompt_runs.count < ${MAX_PROMPT_RUNS_PER_DAY}
        RETURNING count`;
    }),
  );
  return rows.length > 0;
}

export async function executePromptRoutine(
  ports: ExecuteRoutinePorts,
  row: RoutineRow,
  options: ExecuteRoutineOptions,
  at: Date,
  startedAt: number,
): Promise<void> {
  const runPrompt = ports.runPrompt;
  if (runPrompt === undefined || row.prompt === null) {
    options.logger.warn({ routineId: row.id, aiId: row.aiId }, 'prompt routine skipped: no runner');
    await markSkipped(options.db, options, row, at, startedAt);
    return;
  }

  if (!(await claimPromptRun(options.db, row.aiId, at))) {
    options.logger.warn({ routineId: row.id, aiId: row.aiId }, 'prompt routine skipped: daily cap');
    await markSkipped(options.db, options, row, at, startedAt);
    return;
  }

  let outcome: PromptRunOutcome;
  try {
    outcome = await runPrompt({
      aiId: row.aiId,
      groupId: row.groupId,
      topicId: row.topicId,
      routineId: row.id,
      title: row.title,
      prompt: row.prompt,
    });
  } catch {
    // A throwing runner did not produce an answer: count it a failure, like
    // `failed`. The error text never reaches the chat or the audit.
    outcome = 'failed';
  }

  if (outcome === 'replied') {
    await markOk(options.db, options, row, at, startedAt);
    return;
  }
  if (outcome === 'failed') {
    await recordFailure(options.db, options, ports, row, at, startedAt);
    return;
  }
  await markSkipped(options.db, options, row, at, startedAt);
}
