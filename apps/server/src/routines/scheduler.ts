// T-0104: the routine scheduler. A timer (default 30 s) claims due
// routines exactly once and runs them through `executeRoutine` in
// `execute.ts`. Tests call `tick()` directly with a fake clock and fake
// `runTool`/`post` ports; production wires the real ones in `index.ts`.
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { routines } from '../db/schema';
import { type ExecuteRoutinePorts, executeRoutine } from './execute';
import { nextRunAfter, parseRoutineSchedule } from './schedule';

// At most this many routines run at the same time inside one tick. A slow
// tool run must not fan out without bound when many routines come due at
// once.
export const MAX_CONCURRENT_RUNS = 2;

export interface RoutineLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface CreateRoutineSchedulerOptions {
  db: ServerDatabase;
  runTool: ExecuteRoutinePorts['runTool'];
  post: ExecuteRoutinePorts['post'];
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
  /** One sweep: claims due routines and runs them. Never overlaps itself. */
  tick: () => Promise<void>;
}

export function createRoutineScheduler(
  options: CreateRoutineSchedulerOptions,
): RoutineSchedulerHandle {
  const tickMs = options.tickMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  const maxPerTick = options.maxPerTick ?? 5;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let running = false;

  async function tick(): Promise<void> {
    // A tick never overlaps the previous one: when the database or the
    // runner is slow, the late tick is skipped and the next interval
    // picks the rows up (their `next_run_at` is already in the past).
    if (running) {
      return;
    }
    running = true;
    try {
      const claimed = await claimDue(options.db, now(), maxPerTick, options.logger);
      await runClaimed(claimed, options, now);
    } finally {
      running = false;
    }
  }

  function schedule(): void {
    if (closed) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void tick()
        .catch((error: unknown) => {
          options.logger.error({ err: errorName(error) }, 'routines scheduler tick failed');
        })
        .finally(() => {
          schedule();
        });
    }, tickMs);
    timer.unref();
  }

  return {
    start(): void {
      // First run after one interval, not at boot, so startup is never
      // blocked. `index.ts` starts the scheduler after `serve()` resolves.
      schedule();
    },
    stop(): void {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    tick,
  };
}

export type ClaimedRoutine = typeof routines.$inferSelect;

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
async function claimDue(
  db: ServerDatabase,
  nowDate: Date,
  maxPerTick: number,
  logger: RoutineLogger,
): Promise<ClaimedRoutine[]> {
  const due = await db
    .select()
    .from(routines)
    .where(
      and(
        eq(routines.status, 'active'),
        isNull(routines.deletedAt),
        lte(routines.nextRunAt, nowDate),
      ),
    )
    .orderBy(asc(routines.nextRunAt))
    .limit(maxPerTick);
  const claimed: ClaimedRoutine[] = [];
  for (const row of due) {
    const parsed = parseRoutineSchedule(row.schedule);
    if (!parsed.ok) {
      // A row whose schedule no longer validates (older code wrote it)
      // would otherwise spin every tick: log the id and park it one hour
      // out as a dead-letter spot. No audit: the row carries no output.
      logger.warn({ routineId: row.id }, 'routine has an invalid schedule; parking it');
      await db
        .update(routines)
        .set({ nextRunAt: new Date(nowDate.getTime() + 3_600_000), updatedAt: nowDate })
        .where(and(eq(routines.id, row.id), eq(routines.nextRunAt, row.nextRunAt)));
      continue;
    }
    const advanced = nextRunAfter(parsed.value, nowDate);
    const updated = await db
      .update(routines)
      .set({ nextRunAt: advanced, updatedAt: nowDate })
      .where(
        and(
          eq(routines.id, row.id),
          eq(routines.status, 'active'),
          isNull(routines.deletedAt),
          eq(routines.nextRunAt, row.nextRunAt),
        ),
      )
      .returning();
    if (updated.length > 0) {
      claimed.push({ ...row, nextRunAt: advanced });
    }
  }
  return claimed;
}

// Runs the claimed routines with at most `MAX_CONCURRENT_RUNS` in flight.
async function runClaimed(
  claimed: ClaimedRoutine[],
  options: CreateRoutineSchedulerOptions,
  now: () => Date,
): Promise<void> {
  const at = now();
  for (let index = 0; index < claimed.length; index += MAX_CONCURRENT_RUNS) {
    const batch = claimed.slice(index, index + MAX_CONCURRENT_RUNS);
    const tickNow = (): Date => at;
    await Promise.all(
      batch.map((row) =>
        executeRoutine({ runTool: options.runTool, post: options.post }, row, {
          db: options.db,
          now: tickNow,
          audit: options.audit,
          logger: options.logger,
        }).catch((error: unknown) => {
          // `executeRoutine` handles every expected failure itself; this
          // is the backstop for a database write failing mid-run.
          options.logger.error({ err: errorName(error), routineId: row.id }, 'routine run failed');
        }),
      ),
    );
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}
