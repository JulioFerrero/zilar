// A timer (default 30 s) claims due routines exactly once and runs them through `executeRoutine`.
import { Cause, Effect, Schedule, type Fiber } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/recorder';
import type { ServerDatabase } from '../db/client';
import { errorName } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { type ExecuteRoutinePorts, executeRoutine } from './execute';
import { nextRunAfter, parseRoutineSchedule } from './schedule';
import { type RoutineRow } from '../db/rows-agents';

// Claimed runs queue and drain at this limit, so a slow run never makes the next tick skip.
export const MAX_CONCURRENT_RUNS = 2;

// A run more than this far past due is recorded `skipped` and rescheduled; an 8-hour-old run is worse than none.
export const MISSED_AFTER_LATE_MS = 3_600_000;

export interface RoutineLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface CreateRoutineSchedulerOptions {
  db: ServerDatabase;
  runTool: ExecuteRoutinePorts['runTool'];
  post: ExecuteRoutinePorts['post'];
  // The prompt-routine runner; absent until the gateway is wired.
  runPrompt?: ExecuteRoutinePorts['runPrompt'];
  // Corrects the linked alert card in the room (the gateway).
  correctCard?: ExecuteRoutinePorts['correctCard'];
  audit: AuditRecorder;
  logger: RoutineLogger;
  // Tick cadence in milliseconds. Defaults to 30 s.
  tickMs?: number;
  // Source of the wall clock; tests override it.
  now?: () => Date;
  // Max due routines claimed per tick, oldest first. Defaults to 5.
  maxPerTick?: number;
}

export interface RoutineSchedulerHandle {
  start: () => void;
  stop: () => void;
  // One sweep: claims due routines and enqueues them; never blocks on runs.
  tick: () => Promise<void>;
  // Resolves when no claimed run is queued or in flight (tests).
  whenIdle: () => Promise<void>;
}

export function createRoutineScheduler(
  options: CreateRoutineSchedulerOptions,
): RoutineSchedulerHandle {
  const tickMs = options.tickMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  const maxPerTick = options.maxPerTick ?? 5;
  let fiber: Fiber.Fiber<void, never> | null = null;
  let closed = false;

  // Ticks enqueue and return, so the background loop keeps claiming while runs are slow.
  const queue: ClaimedRoutine[] = [];
  let activeRuns = 0;
  let idleResolvers: Array<() => void> = [];

  // A routine whose previous run is queued or running is not queued again, so 1-minute schedules cannot pile up.
  const inFlight = new Set<string>();

  function notifyIfIdle(): void {
    if (activeRuns !== 0 || queue.length !== 0) {
      return;
    }
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  function whenIdle(): Promise<void> {
    if (activeRuns === 0 && queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      idleResolvers.push(resolve);
    });
  }

  // The backstop for a database write failing mid-run; lateness is re-checked at dequeue because a run can wait behind slow ones.
  function runOne(claimed: ClaimedRoutine): Promise<void> {
    const row = claimed.row;
    return Effect.runPromise(
      Effect.promise(async () => {
        const at = now();
        const lateByMs = at.getTime() - claimed.dueAt.getTime();
        if (lateByMs > MISSED_AFTER_LATE_MS) {
          await markQueuedMissed(options.db, row, at, lateByMs, options.logger);
          return;
        }
        await executeRoutine(
          {
            runTool: options.runTool,
            post: options.post,
            ...(options.runPrompt === undefined ? {} : { runPrompt: options.runPrompt }),
            ...(options.correctCard === undefined ? {} : { correctCard: options.correctCard }),
          },
          row,
          {
            db: options.db,
            now,
            audit: options.audit,
            logger: options.logger,
          },
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            options.logger.error(
              { err: errorName(Cause.squash(cause)), routineId: row.id },
              'routine run failed',
            );
          }),
        ),
      ),
    );
  }

  function pump(): void {
    while (activeRuns < MAX_CONCURRENT_RUNS && queue.length > 0) {
      const queued = queue.shift();
      if (queued === undefined) {
        break;
      }
      activeRuns += 1;
      void runOne(queued).finally(() => {
        inFlight.delete(queued.row.id);
        activeRuns -= 1;
        pump();
        notifyIfIdle();
      });
    }
    notifyIfIdle();
  }

  async function tick(): Promise<void> {
    // The claim is a compare-and-set, so two racing ticks are safe; the pool bounds how many run.
    const claimed = await claimDue(options.db, now(), maxPerTick, options.logger);
    for (const routine of claimed) {
      if (inFlight.has(routine.row.id)) {
        options.logger.info(
          { routineId: routine.row.id },
          'routine is still queued or running; skipping this run',
        );
        continue;
      }
      inFlight.add(routine.row.id);
      queue.push(routine);
    }
    pump();
  }

  // Interrupting the fiber clears its timer; the `closed` flag keeps a stopped scheduler from restarting.
  function loop(): Effect.Effect<void, never, never> {
    const tickEffect = Effect.promise(() => tick()).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          options.logger.error(
            { err: errorName(Cause.squash(cause)) },
            'routines scheduler tick failed',
          );
        }),
      ),
    );
    return Effect.sleep(tickMs).pipe(
      Effect.andThen(Effect.repeat(tickEffect, Schedule.spaced(tickMs))),
    );
  }

  return {
    start(): void {
      // First run after one interval, so startup is never blocked.
      if (closed || fiber !== null) {
        return;
      }
      fiber = Effect.runFork(loop());
    },
    stop(): void {
      closed = true;
      if (fiber !== null) {
        fiber.interruptUnsafe();
        fiber = null;
      }
    },
    tick,
    whenIdle,
  };
}

// A claimed run plus the `next_run_at` it was due at, kept to re-check lateness at dequeue.
export interface ClaimedRoutine {
  row: RoutineRow;
  dueAt: Date;
}

// Selects due rows and claims each with a conditional update, so exactly one scheduler wins and the loser sees zero rows.
// A crash between claim and run skips that slot, never duplicates; a long outage runs once, not once per missed slot.
// A row more than MISSED_AFTER_LATE_MS late is recorded `skipped` and rescheduled.
async function claimDue(
  db: ServerDatabase,
  nowDate: Date,
  maxPerTick: number,
  logger: RoutineLogger,
): Promise<ClaimedRoutine[]> {
  const due = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT *
        FROM routines
        WHERE status = 'active' AND deleted_at IS NULL AND next_run_at <= ${nowDate}
        ORDER BY next_run_at ASC
        LIMIT ${maxPerTick}`;
    }),
  );
  const claimed: ClaimedRoutine[] = [];
  // An unschedulable row is parked one hour out so it does not spin every tick.
  const parkOneHourOut = async (row: RoutineRow): Promise<void> => {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE routines
          SET next_run_at = ${new Date(nowDate.getTime() + 3_600_000)}, updated_at = ${nowDate}
          WHERE id = ${row.id} AND next_run_at = ${row.nextRunAt}`;
      }),
    );
  };
  for (const row of due) {
    const parsed = parseRoutineSchedule(row.schedule);
    if (!parsed.ok) {
      logger.warn({ routineId: row.id }, 'routine has an invalid schedule; parking it');
      await parkOneHourOut(row);
      continue;
    }
    let advanced: Date;
    try {
      advanced = nextRunAfter(parsed.value, nowDate);
    } catch {
      // One bad row must not fail the tick for every other routine.
      logger.warn({ routineId: row.id }, 'routine schedule could not advance; parking it');
      await parkOneHourOut(row);
      continue;
    }
    const lateByMs = nowDate.getTime() - row.nextRunAt.getTime();
    const missed = lateByMs > MISSED_AFTER_LATE_MS;
    const updated = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        if (missed) {
          return yield* sql<RoutineRow>`UPDATE routines
            SET next_run_at = ${advanced}, last_run_at = ${nowDate}, last_status = 'skipped', updated_at = ${nowDate}
            WHERE id = ${row.id} AND status = 'active' AND deleted_at IS NULL AND next_run_at = ${row.nextRunAt}
            RETURNING *`;
        }
        return yield* sql<RoutineRow>`UPDATE routines
          SET next_run_at = ${advanced}, updated_at = ${nowDate}
          WHERE id = ${row.id} AND status = 'active' AND deleted_at IS NULL AND next_run_at = ${row.nextRunAt}
          RETURNING *`;
      }),
    );
    if (updated.length === 0) {
      continue;
    }
    if (missed) {
      logger.warn(
        { routineId: row.id, lateMs: lateByMs },
        'routine run missed: more than 1 h late; next run scheduled',
      );
      continue;
    }
    claimed.push({ row, dueAt: row.nextRunAt });
  }
  return claimed;
}

// A run claimed on time that waited past the missed threshold is recorded `skipped`; `next_run_at` already advanced.
async function markQueuedMissed(
  db: ServerDatabase,
  row: RoutineRow,
  at: Date,
  lateByMs: number,
  logger: RoutineLogger,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_run_at = ${at}, last_status = 'skipped', updated_at = ${at}
        WHERE id = ${row.id}`;
    }),
  );
  logger.warn(
    { routineId: row.id, lateMs: lateByMs },
    'routine run missed: more than 1 h late when dequeued; next run already scheduled',
  );
}
