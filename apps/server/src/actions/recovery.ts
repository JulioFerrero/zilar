import { Effect, Schedule, type Fiber } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ApprovalRow, PendingActionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import type { ActionGateway, ActionGatewayDependencies, ActionGatewayLogger } from './gateway';
import { cancelPending } from './queries';
import { errorName } from './support';

// 10 minutes: a `running` row older than this is considered stuck and
// `recoverStuck` flips it to `failed` without re-executing.
export const STUCK_RUNNING_MS = 10 * 60 * 1000;

// Handle returned by `startRecoveryStuckTimer`. A background Effect fiber
// that runs `recoverStuck` on a cadence, with `close()` to stop it on
// shutdown. The loop never re-runs an action: `recoverStuck` only marks
// `running` rows as `failed` and cancels `waiting` rows whose approval is
// past due.
export interface RecoveryStuckHandle {
  close: () => void;
}

export interface StartRecoveryStuckTimerOptions {
  gateway: ActionGateway;
  logger: ActionGatewayLogger;
  intervalMs?: number;
}

export function startRecoveryStuckTimer({
  gateway,
  logger,
  intervalMs = 5 * 60 * 1000,
}: StartRecoveryStuckTimerOptions): RecoveryStuckHandle {
  let fiber: Fiber.Fiber<void, never> | null = null;

  // Today's tick: run `recoverStuck`, log a failure with the error class
  // name only, and let the loop carry on either way.
  async function tick(): Promise<void> {
    try {
      await gateway.recoverStuck();
    } catch (error) {
      logger.error({ err: errorName(error) }, 'recoverStuck tick failed');
    }
  }

  // The background loop repeats the tick with `Schedule.spaced`, first
  // after one interval. The tick runs uninterruptibly so an in-flight
  // sweep finishes after `close()`, the same shutdown behaviour as the
  // approvals sweeper; only the sleep between ticks is interruptible.
  function loop(): Effect.Effect<void, never, never> {
    const tickEffect = Effect.uninterruptible(Effect.promise(() => tick()));
    return Effect.sleep(intervalMs).pipe(
      Effect.andThen(Effect.repeat(tickEffect, Schedule.spaced(intervalMs))),
    );
  }

  // First run after one interval, not at boot. `index.ts` starts the
  // recovery loop after the edge server is listening (`serveEdgeOnNode` in
  // `index.ts`) so the API is already listening and the timer delay never
  // blocks startup. Callers that want an immediate sweep can call
  // `gateway.recoverStuck()` themselves.
  fiber = Effect.runFork(loop());

  return {
    close(): void {
      if (fiber !== null) {
        fiber.interruptUnsafe();
        fiber = null;
      }
      // An in-flight tick keeps running, but the timer is stopped and no
      // new tick is scheduled. `index.ts` calls `close()` before the
      // database close so the in-flight queries settle on the live
      // connection.
    },
  };
}

// Marks a `running` row older than `STUCK_RUNNING_MS` as `failed` with a
// `reason: 'stuck'` audit entry. Also cancels `waiting` rows whose
// approval is past due. Never re-runs anything: a `running` row's args
// are never executed again.
export async function runRecoverStuck(
  deps: ActionGatewayDependencies,
  now: () => Date,
): Promise<void> {
  const at = now();
  const stuckCutoff = new Date(at.getTime() - STUCK_RUNNING_MS);

  const stuck = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PendingActionRow>`UPDATE pending_actions
        SET status = 'failed', finished_at = ${at}
        WHERE status = 'running' AND started_at < ${stuckCutoff}
        RETURNING *`;
    }),
  );
  for (const row of stuck) {
    await deps.audit.record({
      actorUserId: null,
      aiId: row.aiId,
      groupId: row.groupId,
      action: 'action.failed',
      subjectId: row.id,
      argsHash: row.argsHash,
      costCurrency: null,
      costAmount: null,
      result: 'error',
      detail: { reason: 'stuck' },
    });
  }

  const orphaned = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PendingActionRow>`SELECT * FROM pending_actions
        WHERE status = 'waiting'`;
    }),
  );
  for (const row of orphaned) {
    const [approval] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<
          Pick<ApprovalRow, 'id' | 'expiresAt' | 'status'>
        >`SELECT id, expires_at, status FROM approvals
          WHERE id = ${row.approvalId} LIMIT 1`;
      }),
    );
    if (!approval) {
      continue;
    }
    if (approval.status === 'denied' || approval.expiresAt.getTime() <= at.getTime()) {
      await cancelPending(deps, row, 'denied', at);
    }
  }
}
