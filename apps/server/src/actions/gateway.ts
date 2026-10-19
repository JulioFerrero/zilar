import type { ServerCore } from '../app/deps';

import { type ActionAnnouncer } from './announce';
import { runRequest } from './decisions';
import { type PolicyDenialReason } from './policy';
import { runOnApprovalDecided, cancelPending } from './queries';
import { type ActionContextLogger, type ActionRegistry } from './registry';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { type ApprovalRow, type PendingActionRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { startSweepLoop } from '../effect/sweep-loop';
import { errorName } from './support';
// 10 minutes: older `running` rows are considered stuck and flipped to `failed` without re-executing.
const STUCK_RUNNING_MS = 10 * 60 * 1000;

// Background fiber that runs `recoverStuck` on a cadence; it never re-runs an action.
export interface RecoveryStuckHandle {
  close: () => void;
}

interface StartRecoveryStuckTimerOptions {
  gateway: ActionGateway;
  logger: ActionGatewayLogger;
  intervalMs?: number;
}

export function startRecoveryStuckTimer({
  gateway,
  logger,
  intervalMs = 5 * 60 * 1000,
}: StartRecoveryStuckTimerOptions): RecoveryStuckHandle {
  async function tick(): Promise<void> {
    try {
      await gateway.recoverStuck();
    } catch (error) {
      logger.error({ err: errorName(error) }, 'recoverStuck tick failed');
    }
  }

  // First run after one interval, so the timer delay never blocks startup.
  return startSweepLoop(intervalMs, tick);
}

// Marks stale `running` rows `failed` and cancels `waiting` rows whose approval is past due; never re-runs anything.
async function runRecoverStuck(deps: ActionGatewayDependencies, now: () => Date): Promise<void> {
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

export type { ActionAnnouncer };

// Policy decisions never throw: `executed` carries a summary and optional `modelText` (never stored, audited or announced), `denied` a reason, and `failed` no detail so adapter error text cannot leak.
export type RequestOutcome =
  | { status: 'executed'; summary: string; modelText?: string; posted?: boolean }
  | { status: 'failed' }
  | { status: 'denied'; reason: PolicyDenialReason }
  | { status: 'pending_approval'; approvalId: string };

export interface ActionGatewayLogger extends ActionContextLogger {
  error: (fields: Record<string, unknown>, message: string) => void;
}

// A recorder failure is swallowed: the audit log is best-effort and must not change what the policy answers.
export interface ActionGatewayDependencies extends Pick<ServerCore, 'db' | 'audit'> {
  adapters: ActionRegistry;
  logger: ActionGatewayLogger;
  // Optional port that announces tier-2 requests and outcomes; every call is best-effort.
  announce?: ActionAnnouncer;
  now?: () => Date;
}

export interface ActionGateway {
  request: (params: RequestParams) => Promise<RequestOutcome>;
  onApprovalDecided: (approvalId: string) => Promise<void>;
  recoverStuck: () => Promise<void>;
  listActions: () => Array<{ name: string; description: string; argsExample?: string }>;
}

export interface RequestParams {
  aiId: string;
  groupId?: string;
  // Required with `groupId`; the gateway denies a topic that is not in the group or whose room the AI is not in.
  topicId?: string;
  action: string;
  args: unknown;
  requestedBy: string;
  // A scheduled run has no approver: tier 0/1 unchanged, tier 2 without a rule is denied `needs_approval`.
  unattended?: boolean;
}

export type DeniedReason = PolicyDenialReason;

export function createActionGateway(deps: ActionGatewayDependencies): ActionGateway {
  const now = deps.now ?? (() => new Date());

  return {
    request: (params) => runRequest(deps, params, now),
    onApprovalDecided: (approvalId) => runOnApprovalDecided(deps, approvalId, now),
    recoverStuck: () => runRecoverStuck(deps, now),
    listActions: () => listActions(deps),
  };
}

// Model-facing view: name, description and args example, sorted so the tool definition is stable.
function listActions(
  deps: ActionGatewayDependencies,
): Array<{ name: string; description: string; argsExample?: string }> {
  return Object.values(deps.adapters)
    .map((adapter) => ({
      name: adapter.name,
      description: adapter.description,
      ...(adapter.argsExample === undefined ? {} : { argsExample: adapter.argsExample }),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export { APPROVAL_TTL_MS, MAX_STORED_ARGS_BYTES } from './decisions';
export { RESULT_SUMMARY_MAX } from './support';
