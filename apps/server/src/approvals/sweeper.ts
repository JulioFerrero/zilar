// effect-plain: the tick stays a Promise over expireStale; the loop lives in effect/sweep-loop.ts
import type { ServerDatabase } from '../db/client';
import type { AuditEntry } from '../audit/service';
import { startSweepLoop } from '../effect/sweep-loop';
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

  // First run after one interval, not at boot, so the timer delay never
  // blocks startup.
  return startSweepLoop(intervalMs, tick);
}

// Reduce a thrown error to `{ name, message }`, matching `machines/hub.ts`.
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
