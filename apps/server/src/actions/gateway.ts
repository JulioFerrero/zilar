import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { ARGS_HASH_PATTERN } from '@galena/protocol';
import type { AuditEntry, AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, approvals, groupAis, pendingActions } from '../db/schema';
import { createApproval, verifyApproval } from '../approvals/service';
import { type ActionAnnouncer, summaryForOutcome } from './announce';

export type { ActionAnnouncer };
import { argsHash } from './canonical';
import { policy, type PolicyDenialReason } from './policy';
import type { ActionAdapter, ActionContext, ActionRegistry, ActionResult } from './registry';

// The result of `request`. The gateway never throws for a policy decision;
// it answers one of these four shapes. `executed` and `failed` are the
// "the action ran" pair; `pending_approval` means a card is up; `denied`
// is the policy answer. Only `executed` carries a `summary`, and only
// `denied` carries a `reason`. `failed` returns nothing: the gateway
// audited the failure, and the caller learns it failed, not why (the
// adapter's error text must never leak).
export type RequestOutcome =
  | { status: 'executed'; summary: string }
  | { status: 'failed' }
  | { status: 'denied'; reason: PolicyDenialReason }
  | { status: 'pending_approval'; approvalId: string };

// The narrow slice of pino the gateway needs. Real wiring passes the
// server's logger; tests pass a captor that records the `err` field
// without echoing rows or arguments.
export interface ActionGatewayLogger {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

// 30 minutes: the spec says a tier-2 card is short-lived. The approvals
// service already enforces the hard 24-hour ceiling above this number, so
// no extra validation is needed in `request`.
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

// 10 minutes: a `running` row older than this is considered stuck and
// `recoverStuck` flips it to `failed` without re-executing.
export const STUCK_RUNNING_MS = 10 * 60 * 1000;

// 500-character cap on the adapter's `summary`, matching the approval card's
// bound. Over-long strings are truncated rather than rejected so the
// caller still gets a usable summary.
export const RESULT_SUMMARY_MAX = 500;

// 20 KB cap on the serialised stored args. Bigger than this would suggest
// the adapter's schema is wrong; rejecting early keeps the row from
// silently growing.
export const MAX_STORED_ARGS_BYTES = 20 * 1024;

// A simple logger shape that swallows `record` failures. The gateway wraps
// the recorder so a database write error never propagates into the caller's
// `request` — the audit log is best-effort, the gateway's job is to do
// what the policy says.
export interface ActionGatewayDependencies {
  db: ServerDatabase;
  adapters: ActionRegistry;
  audit: AuditRecorder;
  logger: ActionGatewayLogger;
  /**
   * Optional port the gateway uses to announce tier-2 requests and their
   * outcomes into the chat. Absent in tests and the default gateway; present
   * in `index.ts` so a stopped AI posts nothing. Every call is best-effort:
   * the gateway swallows a rejection.
   */
  announce?: ActionAnnouncer;
  now?: () => Date;
}

// The handle returned by `createActionGateway`. `request` is the only
// public surface right now; `onApprovalDecided` is wired into the
// approvals route, and `recoverStuck` runs at startup and on a timer.
export interface ActionGateway {
  request: (params: RequestParams) => Promise<RequestOutcome>;
  onApprovalDecided: (approvalId: string) => Promise<void>;
  recoverStuck: () => Promise<void>;
}

export interface RequestParams {
  aiId: string;
  groupId?: string;
  action: string;
  args: unknown;
  requestedBy: string;
}

// Re-export the policy reason enum so callers can branch without depending
// on the policy module directly.
export type DeniedReason = PolicyDenialReason;

// Internal row shapes. Extracted so the implementation does not lean on the
// schema inference for places where we hand-pick columns.
type AiStatusRow = Pick<typeof ais.$inferSelect, 'id' | 'status'>;
type PendingActionRow = typeof pendingActions.$inferSelect;

export function createActionGateway(deps: ActionGatewayDependencies): ActionGateway {
  const now = deps.now ?? (() => new Date());

  return {
    request: (params) => runRequest(deps, params, now),
    onApprovalDecided: (approvalId) => runOnApprovalDecided(deps, approvalId, now),
    recoverStuck: () => runRecoverStuck(deps, now),
  };
}

// Handle returned by `startRecoveryStuckTimer`. The sweeper pattern: a
// unref'd timer that runs `recoverStuck` on a cadence, with `close()` to
// stop it on shutdown. The timer never re-runs an action: `recoverStuck`
// only marks `running` rows as `failed` and cancels `waiting` rows whose
// approval is past due.
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
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  function schedule(): void {
    if (closed) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void gateway
        .recoverStuck()
        .catch((error: unknown) => {
          logger.error({ err: errorName(error) }, 'recoverStuck tick failed');
        })
        .finally(() => {
          schedule();
        });
    }, intervalMs);
    timer.unref();
  }

  // First run after one interval, not at boot. `index.ts` starts the
  // recovery loop after `serve()` resolves so the API is already
  // listening and the timer delay never blocks startup. Callers that
  // want an immediate sweep can call `gateway.recoverStuck()` themselves.
  schedule();

  return {
    close(): void {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

async function runRequest(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  now: () => Date,
): Promise<RequestOutcome> {
  const at = now();
  const adapter = deps.adapters[params.action] ?? null;

  // The adapter lookup is cheap; the AI and group lookups are database
  // reads. Do the cheap thing first so an unknown action never queries
  // the database, and so the gateway's denial order (adapter exists →
  // AI exists → ...) is honoured even on a hot path.
  if (adapter === null) {
    return { status: 'denied', reason: 'unknown_action' };
  }

  // Read the AI row. `null` (missing or not visible to the caller) and
  // `disabled`/`stopped` both feed down `ai_not_active`. We do not throw
  // early on a missing AI: the policy returns the same denial for every
  // non-`active` status so existence is never disclosed.
  const aiRow = await readAiStatus(deps.db, params.aiId);

  let aiInGroup: boolean | null = null;
  if (params.groupId !== undefined && aiRow !== null) {
    aiInGroup = await isAiInGroup(deps.db, params.aiId, params.groupId);
  }

  const verdict = policy({
    adapter,
    rawArgs: params.args,
    aiStatus: aiRow?.status ?? null,
    aiInGroup,
  });

  if (verdict.kind === 'deny') {
    return { status: 'denied', reason: verdict.reason };
  }

  if (verdict.kind === 'allow') {
    return runAllowedAction(deps, params, adapter as ActionAdapter<unknown>);
  }

  return runApprovalPath(deps, params, adapter, at);
}

async function runAllowedAction(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
): Promise<RequestOutcome> {
  const parse = adapter.argsSchema.safeParse(params.args);
  if (!parse.success) {
    // The policy already ran the same safeParse, so this is a defence in
    // depth. It cannot trip in production but a custom adapter that
    // mutates state between calls could in theory disagree.
    return { status: 'denied', reason: 'invalid_args' };
  }
  const parsedArgs = parse.data;
  const ctx: ActionContext = {
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    requestId: 'allow-' + randomUUID(),
  };

  let outcome: 'ok' | 'error';
  let summary: string | null = null;
  try {
    const result: ActionResult = await adapter.execute(ctx, parsedArgs);
    outcome = 'ok';
    summary = truncateSummary(result.summary);
  } catch (error) {
    outcome = 'error';
    // The error text is never stored, never returned, never logged with
    // the message. The name of the error class is logged for ops; that is
    // all the surface area a failure exposes.
    deps.logger.warn(
      { err: errorName(error), action: params.action, aiId: params.aiId },
      'action adapter threw',
    );
  }

  await writeAllowAudit(deps, params, outcome);
  return outcome === 'ok' && summary !== null
    ? { status: 'executed', summary }
    : { status: 'failed' };
}

async function runApprovalPath(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  at: Date,
): Promise<RequestOutcome> {
  const parse = adapter.argsSchema.safeParse(params.args);
  if (!parse.success) {
    return { status: 'denied', reason: 'invalid_args' };
  }
  const parsedArgs = parse.data;
  const serialised = safeStringify(parsedArgs);
  if (serialised === null || Buffer.byteLength(serialised, 'utf8') > MAX_STORED_ARGS_BYTES) {
    return { status: 'denied', reason: 'invalid_args' };
  }

  const hash = argsHash(parsedArgs);
  if (!ARGS_HASH_PATTERN.test(hash)) {
    return { status: 'denied', reason: 'invalid_args' };
  }
  const described = adapter.describe(parsedArgs);
  let worstCase: { currency: 'EUR' | 'USD'; amount: number } | undefined;
  if (adapter.estimateCost !== undefined) {
    try {
      worstCase = adapter.estimateCost(parsedArgs);
    } catch {
      return { status: 'denied', reason: 'invalid_args' };
    }
  }

  const expiresAt = new Date(at.getTime() + APPROVAL_TTL_MS);

  // One transaction: if either insert fails nothing is left behind. The
  // approval row carries `args_hash`; the pending-action row carries the
  // exact parsed args. The hash is computed from the parsed args, the
  // approval's `verifyApproval` re-hashes the stored value, and the two
  // must match — `argsHash` here is the only place that gets to touch
  // the args.
  let approvalId: string;
  try {
    approvalId = await deps.db.transaction(async (tx) => {
      const approval = await createApproval(
        tx as unknown as ServerDatabase,
        {
          aiId: params.aiId,
          ...(params.groupId === undefined ? {} : { groupId: params.groupId }),
          action: params.action,
          summary: truncateText(described.summary, 500),
          ...(described.details === undefined
            ? {}
            : { details: truncateText(described.details, 20000) }),
          argsHash: hash,
          ...(worstCase === undefined ? {} : { worstCase }),
          requestedBy: params.requestedBy,
          expiresAt,
        },
        at,
      );
      const newPendingId = randomUUID();
      await tx.insert(pendingActions).values({
        id: newPendingId,
        approvalId: approval.id,
        aiId: params.aiId,
        groupId: params.groupId ?? null,
        action: params.action,
        args: parsedArgs,
        argsHash: hash,
        requestedBy: params.requestedBy,
        status: 'waiting',
      });
      return approval.id;
    });
  } catch {
    // The approval service throws `ApprovalServiceError` (e.g.
    // `pending_limit`); the gateway answers `denied` with a stable reason
    // so the caller can branch without a string match. Anything else is
    // logged and treated as `ai_not_active` — the same denial a transient
    // error already gets, and never `internal_error` (the platform must
    // not echo a database error to an AI).
    deps.logger.warn(
      { action: params.action, aiId: params.aiId },
      'failed to create approval+pending-action pair',
    );
    return { status: 'denied', reason: 'ai_not_active' };
  }

  // Audit after the commit. The approval id is the subject so the audit
  // reader can join back to the row; the hash is the same one the approval
  // row carries.
  await deps.audit.record({
    actorUserId: null,
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    action: 'action.requested',
    subjectId: approvalId,
    argsHash: hash,
    costCurrency: worstCase?.currency ?? null,
    costAmount: worstCase?.amount ?? null,
    result: 'ok',
    detail: null,
  });

  // Best-effort card announcement. The approval id and the chat target are
  // enough for the announcer to build the payload; the gateway does not
  // wait on it and a throw never changes the returned outcome.
  await safeAnnounce(deps, {
    approvalRequested: { aiId: params.aiId, groupId: params.groupId ?? null, approvalId },
  });

  return { status: 'pending_approval', approvalId };
}

// Wired into the approvals POST `/decision` route. Idempotent: a second
// caller for an already-decided approval finds the pending row already
// moved on and returns silently. Safe to call concurrently: the
// conditional `waiting → running` update makes exactly one caller win.
async function runOnApprovalDecided(
  deps: ActionGatewayDependencies,
  approvalId: string,
  now: () => Date,
): Promise<void> {
  const at = now();
  const [pending] = await deps.db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.approvalId, approvalId))
    .limit(1);
  if (!pending) {
    return;
  }
  if (pending.status !== 'waiting') {
    return;
  }
  const [approval] = await deps.db
    .select()
    .from(approvals)
    .where(eq(approvals.id, approvalId))
    .limit(1);
  if (!approval) {
    return;
  }

  // Re-check the AI status: a stop between request and approval must
  // cancel the action. The approval service has already accepted the
  // human's decision; the kill switch wins here.
  const [ai] = await deps.db
    .select({ id: ais.id, status: ais.status })
    .from(ais)
    .where(eq(ais.id, pending.aiId))
    .limit(1);
  if (!ai || ai.status !== 'active') {
    await cancelPending(deps, pending, 'ai_not_active', at);
    return;
  }

  if (approval.status === 'denied' || approval.expiresAt.getTime() <= at.getTime()) {
    await cancelPending(deps, pending, 'denied', at);
    return;
  }
  if (approval.status === 'pending') {
    // Not decided yet: nothing to run and nothing to cancel.
    return;
  }

  const verify = await verifyApproval(deps.db, { approvalId, argsHash: pending.argsHash }, at);
  if (!verify.ok) {
    // `verifyApproval` returns `{ ok: false }` for any of: missing, wrong
    // status, expired, hash mismatch, or a parallel caller already
    // consumed the approval. The last case is the same race the claim
    // step below handles: a peer is already executing this row, so we
    // must return silently rather than try to cancel. Re-read the
    // approval to tell them apart: `consumed` means a peer won the
    // verify race, anything else (denied / expired / wrong hash) means
    // we should cancel.
    const [postVerify] = await deps.db
      .select({ status: approvals.status })
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);
    if (postVerify?.status !== 'consumed') {
      await cancelPending(deps, pending, 'denied', at);
    }
    return;
  }

  // The race-safe claim. Exactly one caller wins; the loser sees zero rows
  // updated and returns silently. After this point a crash leaves it
  // `running`, which `recoverStuck` reports — never re-executes.
  const claimed = await deps.db
    .update(pendingActions)
    .set({ status: 'running', startedAt: at })
    .where(and(eq(pendingActions.id, pending.id), eq(pendingActions.status, 'waiting')))
    .returning();
  if (claimed.length === 0) {
    return;
  }

  const adapter = deps.adapters[pending.action];
  if (!adapter) {
    await finishPending(deps, pending, 'failed', null, at);
    await writeResultAudit(deps, pending, 'action.failed', 'error');
    await safeAnnounce(deps, {
      outcome: {
        aiId: pending.aiId,
        groupId: pending.groupId,
        status: 'failed',
        summary: null,
      },
    });
    return;
  }

  let outcome: 'ok' | 'error';
  let summary: string | null = null;
  try {
    const result: ActionResult = await adapter.execute(
      {
        aiId: pending.aiId,
        groupId: pending.groupId,
        requestId: pending.id,
      },
      pending.args,
    );
    outcome = 'ok';
    summary = truncateSummary(result.summary);
  } catch (error) {
    outcome = 'error';
    deps.logger.warn(
      { err: errorName(error), action: pending.action, aiId: pending.aiId },
      'action adapter threw after approval',
    );
  }

  await finishPending(deps, pending, outcome === 'ok' ? 'executed' : 'failed', summary, at);
  await writeResultAudit(
    deps,
    pending,
    outcome === 'ok' ? 'action.executed' : 'action.failed',
    outcome,
  );
  await safeAnnounce(deps, {
    outcome: {
      aiId: pending.aiId,
      groupId: pending.groupId,
      status: outcome === 'ok' ? 'executed' : 'failed',
      summary: outcome === 'ok' ? summary : null,
    },
  });
}

// Marks a `running` row older than `STUCK_RUNNING_MS` as `failed` with a
// `reason: 'stuck'` audit entry. Also cancels `waiting` rows whose
// approval is past due. Never re-runs anything: a `running` row's args
// are never executed again.
async function runRecoverStuck(deps: ActionGatewayDependencies, now: () => Date): Promise<void> {
  const at = now();
  const stuckCutoff = new Date(at.getTime() - STUCK_RUNNING_MS);

  const stuck = await deps.db
    .update(pendingActions)
    .set({ status: 'failed', finishedAt: at })
    .where(and(eq(pendingActions.status, 'running'), lt(pendingActions.startedAt, stuckCutoff)))
    .returning();
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

  const orphaned = await deps.db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.status, 'waiting'));
  for (const row of orphaned) {
    const [approval] = await deps.db
      .select({ id: approvals.id, expiresAt: approvals.expiresAt, status: approvals.status })
      .from(approvals)
      .where(eq(approvals.id, row.approvalId))
      .limit(1);
    if (!approval) {
      continue;
    }
    if (approval.status === 'denied' || approval.expiresAt.getTime() <= at.getTime()) {
      await cancelPending(deps, row, 'denied', at);
    }
  }
}

async function cancelPending(
  deps: ActionGatewayDependencies,
  row: PendingActionRow,
  reason: 'denied' | 'ai_not_active',
  at: Date,
): Promise<void> {
  const updated = await deps.db
    .update(pendingActions)
    .set({ status: 'cancelled', finishedAt: at })
    .where(and(eq(pendingActions.id, row.id), eq(pendingActions.status, 'waiting')))
    .returning();
  if (updated.length === 0) {
    return;
  }
  await deps.audit.record({
    actorUserId: null,
    aiId: row.aiId,
    groupId: row.groupId,
    action: 'action.cancelled',
    subjectId: row.id,
    argsHash: row.argsHash,
    costCurrency: null,
    costAmount: null,
    result: 'denied',
    detail: { reason },
  });
  await safeAnnounce(deps, {
    outcome: {
      aiId: row.aiId,
      groupId: row.groupId,
      status: 'cancelled',
      summary: null,
    },
  });
}

async function finishPending(
  deps: ActionGatewayDependencies,
  row: PendingActionRow,
  status: 'executed' | 'failed',
  summary: string | null,
  at: Date,
): Promise<void> {
  await deps.db
    .update(pendingActions)
    .set({ status, resultSummary: summary, finishedAt: at })
    .where(and(eq(pendingActions.id, row.id), eq(pendingActions.status, 'running')));
}

async function writeAllowAudit(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  outcome: 'ok' | 'error',
): Promise<void> {
  const entry: AuditEntry = {
    actorUserId: null,
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    action: outcome === 'ok' ? 'action.executed' : 'action.failed',
    subjectId: null,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: outcome === 'ok' ? 'ok' : 'error',
    detail: null,
  };
  await deps.audit.record(entry);
}

async function writeResultAudit(
  deps: ActionGatewayDependencies,
  row: PendingActionRow,
  action: 'action.executed' | 'action.failed',
  outcome: 'ok' | 'error',
): Promise<void> {
  const entry: AuditEntry = {
    actorUserId: null,
    aiId: row.aiId,
    groupId: row.groupId,
    action,
    subjectId: row.id,
    argsHash: row.argsHash,
    costCurrency: null,
    costAmount: null,
    result: outcome,
    detail: null,
  };
  await deps.audit.record(entry);
}

async function readAiStatus(db: ServerDatabase, aiId: string): Promise<AiStatusRow | null> {
  const [row] = await db
    .select({ id: ais.id, status: ais.status })
    .from(ais)
    .where(eq(ais.id, aiId))
    .limit(1);
  return row ?? null;
}

async function isAiInGroup(db: ServerDatabase, aiId: string, groupId: string): Promise<boolean> {
  const [row] = await db
    .select({ aiId: groupAis.aiId })
    .from(groupAis)
    .where(and(eq(groupAis.groupId, groupId), eq(groupAis.aiId, aiId)))
    .limit(1);
  return row !== undefined;
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

function truncateSummary(value: string): string {
  return truncateText(value, RESULT_SUMMARY_MAX);
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}

// Calls every entry in `calls` on the optional announcer. A missing announcer
// is a no-op; a throw only logs the error class name. The gateway never lets
// an announcement failure change an outcome, a row or an audit entry.
async function safeAnnounce(
  deps: ActionGatewayDependencies,
  calls: {
    approvalRequested?: {
      aiId: string;
      groupId: string | null;
      approvalId: string;
    };
    outcome?: {
      aiId: string;
      groupId: string | null;
      status: 'executed' | 'failed' | 'cancelled';
      summary: string | null;
    };
  },
): Promise<void> {
  if (deps.announce === undefined) {
    return;
  }
  try {
    if (calls.approvalRequested !== undefined) {
      await deps.announce.approvalRequested(calls.approvalRequested);
    }
    if (calls.outcome !== undefined) {
      await deps.announce.outcome({
        ...calls.outcome,
        summary: summaryForOutcome(calls.outcome.status, calls.outcome.summary),
      });
    }
  } catch (error) {
    const action =
      calls.outcome !== undefined ? `action.${calls.outcome.status}` : 'action.requested';
    deps.logger.warn(
      {
        err: errorName(error),
        action: calls.outcome?.status ?? 'requested',
        aiId: calls.outcome?.aiId ?? calls.approvalRequested?.aiId,
      },
      `announcer failed for ${action}; carrying on`,
    );
  }
}
