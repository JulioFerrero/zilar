import { Effect, Schedule, type Fiber } from 'effect';
import type { ServerDatabase } from '../db/client';
import type { AuditEntry } from '../audit/service';
import { expireStale } from './service';

// The minimum slice of pino's Logger the sweeper needs. The real server wires
// its own logger; tests can pass a captor.
export interface SweeperLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface StartApprovalsSweeperOptions {
  db: ServerDatabase;
  /**
   * Audit recorder. Each swept row writes exactly one `approval.expired`
   * entry. Production wires the server's own `createAuditRecorder`, which
   * already swallows write errors so the timer keeps running; tests may
   * pass a strict recorder to verify a failing sweep does not stop the
   * timer.
   */
  audit: { record: (entry: AuditEntry) => Promise<void> };
  logger: SweeperLogger;
  /** Tick cadence in milliseconds. Defaults to 60 s. */
  intervalMs?: number;
  /** Source of the wall clock; tests override it. */
  now?: () => Date;
}

export interface ApprovalsSweeperHandle {
  close(): void;
}

// `expireStale` already has a conditional update (`status = 'pending' AND
// expires_at < now`), so two sweeps racing are safe: the second just sees an
// empty `RETURNING`. We also gate the next tick on the previous one finishing
// so a slow database cannot stack overlapping sweeps.
export function startApprovalsSweeper({
  db,
  audit,
  logger,
  intervalMs = 60_000,
  now = () => new Date(),
}: StartApprovalsSweeperOptions): ApprovalsSweeperHandle {
  let fiber: Fiber.Fiber<void, never> | null = null;

  async function tick(): Promise<void> {
    const at = now();
    let swept: Array<{ id: string; aiId: string; groupId: string | null }>;
    try {
      swept = await expireStale(db, at);
    } catch (error) {
      // Log the bare error and nothing else: no row ids, no AI ids. The
      // row data will come back from a successful next tick anyway.
      logger.error({ err: serializeError(error) }, 'approvals sweeper tick failed');
      return;
    }
    for (const row of swept) {
      try {
        await audit.record({
          action: 'approval.expired',
          actorUserId: null,
          aiId: row.aiId,
          groupId: row.groupId,
          subjectId: row.id,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'denied',
          detail: null,
        });
      } catch (error) {
        logger.error({ err: serializeError(error) }, 'approvals sweeper audit write failed');
      }
    }
  }

  // The background loop repeats the tick with `Schedule.spaced`, first
  // after one interval. The tick runs uninterruptibly so an in-flight
  // sweep finishes after `close()`; only the sleep between ticks is
  // interruptible.
  function loop(): Effect.Effect<void, never, never> {
    const tickEffect = Effect.uninterruptible(Effect.promise(() => tick()));
    return Effect.sleep(intervalMs).pipe(
      Effect.andThen(Effect.repeat(tickEffect, Schedule.spaced(intervalMs))),
    );
  }

  // First run after one interval, not at boot. `index.ts` starts the sweeper
  // after `serve()` resolves so the API is already listening and the timer
  // delay never blocks startup.
  fiber = Effect.runFork(loop());

  return {
    close(): void {
      if (fiber !== null) {
        fiber.interruptUnsafe();
        fiber = null;
      }
      // An in-flight tick keeps running (its `await audit.record` calls have
      // no other side effects), but the timer is stopped and no new tick
      // is scheduled. `index.ts` calls `close()` before the database close
      // so the in-flight queries settle on the live connection.
    },
  };
}

// Reduce a thrown error to `{ name, message }`, matching `machines/hub.ts`.
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
