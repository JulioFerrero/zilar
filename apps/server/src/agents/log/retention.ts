// T-1426: the retention sweeper for `agent_task_events`. Rows older than 30
// days are deleted by a leader-only 60 s tick registered next to the approvals
// sweeper (`leader/start.ts`). A tick failure logs and never throws, so the
// timer keeps running.
import { Effect, Schedule, type Fiber } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';

/** The retention window; the lead's decision (T-1398 Review). */
export const TASK_EVENT_RETENTION_DAYS = 30;

/** The oldest `at` a row may keep at `now`. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - TASK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Deletes every row older than `cutoff`; returns how many left. */
export async function deleteEventsOlderThan(db: ServerDatabase, cutoff: Date): Promise<number> {
  const removed = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`DELETE FROM agent_task_events
        WHERE at < ${cutoff} RETURNING id`;
    }),
  );
  return removed.length;
}

/** The slice of pino the sweeper needs. */
export interface RetentionSweeperLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface StartTaskEventRetentionOptions {
  db: ServerDatabase;
  logger: RetentionSweeperLogger;
  /** Tick cadence in milliseconds. Defaults to 60 s. */
  intervalMs?: number;
  /** Source of the wall clock; tests override it. */
  now?: () => Date;
}

export interface TaskEventRetentionHandle {
  close(): void;
}

// The same shape as the approvals sweeper: the first tick runs after one
// interval, not at boot, so startup never blocks on the database.
export function startTaskEventRetention({
  db,
  logger,
  intervalMs = 60_000,
  now = () => new Date(),
}: StartTaskEventRetentionOptions): TaskEventRetentionHandle {
  let fiber: Fiber.Fiber<void, never> | null = null;

  async function tick(): Promise<void> {
    try {
      await deleteEventsOlderThan(db, retentionCutoff(now()));
    } catch (error) {
      // Log the bare error only: no ids, no row data.
      logger.error(
        { err: error instanceof Error ? error.name : typeof error },
        'task event retention sweep failed',
      );
    }
  }

  function loop(): Effect.Effect<void, never, never> {
    const tickEffect = Effect.uninterruptible(Effect.promise(() => tick()));
    return Effect.sleep(intervalMs).pipe(
      Effect.andThen(Effect.repeat(tickEffect, Schedule.spaced(intervalMs))),
    );
  }

  fiber = Effect.runFork(loop());

  return {
    close(): void {
      if (fiber !== null) {
        fiber.interruptUnsafe();
        fiber = null;
      }
    },
  };
}
