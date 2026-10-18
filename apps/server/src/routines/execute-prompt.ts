// A prompt routine asks the AI gateway for one scheduled turn through the optional `runPrompt` port; without it the run is `skipped`.
// The per-AI, per-UTC-day cap (1440) is taken atomically before the turn, so parallel schedulers cannot overshoot.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { ExecuteRoutineOptions, ExecuteRoutinePorts } from './execute';
import { markOk, markSkipped, recordFailure } from './outcomes';

export type PromptRunOutcome =
  'replied' | 'failed' | 'stopped' | 'limited' | 'offline' | 'not_in_room';

// The AI gateway's scheduled turn; absent until wired, so the run is recorded `skipped`.
export type PromptRunner = (input: {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  routineId: string;
  title: string;
  prompt: string;
}) => Promise<PromptRunOutcome>;

// At most this many prompt runs per AI per UTC day, so a runaway routine cannot burn the budget.
export const MAX_PROMPT_RUNS_PER_DAY = 1440;

interface PromptRunCountRow {
  count: number;
}

// One statement, so two racing schedulers cannot exceed the cap; a row returns only when a slot was taken.
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

// Gives back a slot when the run never reached the AI; `count > 0` keeps a stray refund from going negative.
export async function refundPromptRun(db: ServerDatabase, aiId: string, at: Date): Promise<void> {
  const day = at.toISOString().slice(0, 10);
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routine_prompt_runs
        SET count = routine_prompt_runs.count - 1
        WHERE ai_id = ${aiId} AND day = ${day} AND count > 0`;
    }),
  );
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
    // A throwing runner counts as a failure; the error text never reaches the chat or the audit.
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
  if (outcome === 'offline' || outcome === 'not_in_room') {
    // The run never reached the AI, so refund the slot; ids only.
    options.logger.warn(
      { routineId: row.id, aiId: row.aiId, outcome },
      'prompt routine skipped: AI not reachable',
    );
    await refundPromptRun(options.db, row.aiId, at);
    await markSkipped(options.db, options, row, at, startedAt);
    return;
  }
  await markSkipped(options.db, options, row, at, startedAt);
}
