// effect-plain: the tick stays a Promise over expireStale; the loop lives in effect/sweep-loop.ts
import type { ServerDatabase } from '../db/client';
import type { AuditEntry } from '../audit/schema';
import { startSweepLoop } from '../effect/sweep-loop';
import { expireStale } from './service';

// The minimum slice of pino's Logger the sweeper needs.
export interface SweeperLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

export interface StartApprovalsSweeperOptions {
  db: ServerDatabase;
  /** Each swept row writes exactly one `approval.expired` entry. */
  audit: { record: (entry: AuditEntry) => Promise<void> };
  logger: SweeperLogger;
  /** Tick cadence in milliseconds. Defaults to 60 s. */
  intervalMs?: number;
  now?: () => Date;
}

export interface ApprovalsSweeperHandle {
  close(): void;
}

// `expireStale`'s conditional update makes racing sweeps safe: the second sees
// an empty `RETURNING`.
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
      // No row or AI ids in the log; the next successful tick brings the data.
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

  // First run after one interval, not at boot, so the delay never blocks startup.
  return startSweepLoop(intervalMs, tick);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}
