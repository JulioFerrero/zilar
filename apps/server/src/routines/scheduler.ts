// T-0104: the routine scheduler. A timer (default 30 s) claims due
// routines exactly once and runs them through `executeRoutine` in
// `execute.ts`. Tests call `tick()` directly with a fake clock and fake
// `runTool`/`post` ports; production wires the real ones in `index.ts`.
import { Cause, Effect, Schedule, type Fiber } from 'effect';
import { SqlClient } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { RoutineRow } from '../db/rows';
import { errorName } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { type ExecuteRoutinePorts, executeRoutine } from './execute';
import { nextRunAfter, parseRoutineSchedule } from './schedule';

// At most this many routines run at the same time. Claimed runs wait in a
// queue and drain at this limit, so a slow run no longer makes the next tick
// skip: ticks keep claiming and enqueueing while the pool works (AI-18).
export const MAX_CONCURRENT_RUNS = 2;

// AI-18: a due run more than this far past its scheduled time is recorded as
// missed (`last_status = 'skipped'`) and its next run is scheduled, with no
// post: firing an 8-hour-old run is worse than skipping it.
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
  /** T-1645: the prompt-routine runner; absent until the gateway is wired. */
  runPrompt?: ExecuteRoutinePorts['runPrompt'];
  /** T-1880: corrects the linked alert card in the room (the gateway). */
  correctCard?: ExecuteRoutinePorts['correctCard'];
  audit: AuditRecorder;
  logger: RoutineLogger;
  /** Tick cadence in milliseconds. Defaults to 30 s. */
  tickMs?: number;
  /** Source of the wall clock; tests override it. */
  now?: () => Date;
  /** Max due routines claimed per tick, oldest first. Defaults to 5. */
  maxPerTick?: number;
}

export interface RoutineSchedulerHandle {
  start: () => void;
  stop: () => void;
  /** One sweep: claims due routines and enqueues them. Never blocks on runs. */
  tick: () => Promise<void>;
  /** Resolves when no claimed run is queued or in flight (tests). */
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

  // Claimed runs wait here until the pool (MAX_CONCURRENT_RUNS) takes them.
  // Ticks enqueue and return, so the background loop keeps claiming on every
  // interval even while runs are slow.
  const queue: ClaimedRoutine[] = [];
  let activeRuns = 0;
  let idleResolvers: Array<() => void> = [];

  // T-1707: routine ids with a claimed run queued or in flight. A routine
  // whose previous run is still queued or running is not queued again: its
  // claim already advanced `next_run_at`, so that slot is skipped. Without
  // this a 1-minute schedule whose AI turn takes minutes would pile up runs.
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

  // Runs one claimed routine, catching every cause: `executeRoutine` handles
  // its expected failures itself, so this is the backstop for a database write
  // failing mid-run. AI-18: lateness is re-checked here, when the pool
  // dequeues the run — one claimed on time can wait behind slow runs for more
  // than an hour, and firing it then would post stale output.
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
    // Claims and enqueues. The claim is a compare-and-set, so two ticks
    // racing on the same rows is safe; the pool below bounds how many run.
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

  // The background loop repeats the tick with `Schedule.spaced`; since a tick
  // now returns as soon as the rows are queued, slow runs never delay the
  // next claim. Interrupting the fiber stops it and clears its timer; the
  // `closed` flag keeps a stopped scheduler from restarting.
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
      // First run after one interval, not at boot, so startup is never
      // blocked. `index.ts` starts the scheduler after the edge server is
      // listening (`serveEdgeOnNode` in `index.ts`).
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

// AI-18: a claimed run plus the `next_run_at` it was due at. The claim
// advances `next_run_at` in the database, so the scheduled time is kept here
// to re-check lateness when the pool finally dequeues the run.
export interface ClaimedRoutine {
  row: RoutineRow;
  dueAt: Date;
}

// Selects due rows (active, not deleted, `next_run_at <= now`, oldest
// first, at most `maxPerTick`) and claims each with a conditional update:
// `next_run_at` advances to the next occurrence **before** the run, and
// only the caller whose update changed a row runs it. Two schedulers (or
// two overlapping manual ticks) racing on the same row both read it, but
// exactly one wins the update — the loser sees zero rows and skips.
//
// Trade-off: if the process dies between the claim and the run, that slot
// is skipped, never duplicated. A routine that is many periods overdue
// (the server was off) runs once, not once per missed slot: the claim
// always advances from `now`, never from the stale `next_run_at`.
//
// AI-18: a row more than MISSED_AFTER_LATE_MS past its due time is not run
// at all — the same update records it `skipped` (the existing status for
// "nothing was posted") and schedules the next occurrence.
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
  // A row that cannot be scheduled — an invalid schedule, or a next run the
  // schedule cannot compute — is parked one hour out as a dead-letter spot so
  // it does not spin every tick. No audit: the row carries no output.
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

// AI-18: a run claimed on time that then waited in the queue past the missed
// threshold is recorded `skipped` with no post. The claim already advanced
// `next_run_at`, so this only records the outcome and does not reschedule.
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
