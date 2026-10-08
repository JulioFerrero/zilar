import { randomUUID } from 'node:crypto';
import { Effect, Schedule, type Fiber } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';
import type { AuditEntry, AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { ais, pendingActions } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import { createApproval, verifyApproval } from '../approvals/service';
import { allowedTopicAiIds } from '../topics/access';
import { findActiveRule } from '../approvals/rules';
import { type ActionAnnouncer, summaryForOutcome } from './announce';

export type { ActionAnnouncer };
import { argsHash } from './canonical';
import { policy, type PolicyDenialReason } from './policy';
import {
  decodeActionArgs,
  stripModelTextCloseTag,
  truncateModelText,
  type ActionAdapter,
  type ActionContext,
  type ActionRegistry,
  type ActionResult,
} from './registry';

// The result of `request`. The gateway never throws for a policy decision;
// it answers one of these four shapes. `executed` carries a `summary` and,
// when the adapter returned one, a `modelText` for the model only (never
// stored, never audited, never announced — see `ActionResult.modelText`);
// `denied` carries a `reason`. `failed` returns nothing: the gateway
// audited the failure, and the caller learns it failed, not why (the
// adapter's error text must never leak).
export type RequestOutcome =
  | { status: 'executed'; summary: string; modelText?: string }
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
// `listActions` is the read-only view the agent gateway uses to build the
// `request_action` tool definition: every registered action's name and
// description, sorted by name so the order is stable for the model.
export interface ActionGateway {
  request: (params: RequestParams) => Promise<RequestOutcome>;
  onApprovalDecided: (approvalId: string) => Promise<void>;
  recoverStuck: () => Promise<void>;
  listActions: () => Array<{ name: string; description: string }>;
}

export interface RequestParams {
  aiId: string;
  groupId?: string;
  /** The topic the request was raised in. Required with `groupId`
   *  (group scope is always a topic; General is a topic too), absent for
   *  personal chats. The gateway denies the request when the topic does
   *  not belong to the group or the AI is not a member of it. */
  topicId?: string;
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

// Every statement below runs on the `effect/sql` client registered for this
// database (see `../effect/sql`), matching the pins pilot. The exported
// functions stay `async` so routes, the approvals route and the tests keep
// their shape during the transition.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

export function createActionGateway(deps: ActionGatewayDependencies): ActionGateway {
  const now = deps.now ?? (() => new Date());

  return {
    request: (params) => runRequest(deps, params, now),
    onApprovalDecided: (approvalId) => runOnApprovalDecided(deps, approvalId, now),
    recoverStuck: () => runRecoverStuck(deps, now),
    listActions: () => listActions(deps),
  };
}

// The model-facing view of the registry: just name + description, sorted
// by name so the tool definition the AI sees is the same on every turn.
// The full adapter (tier, schema, execute) stays behind the gateway.
function listActions(
  deps: ActionGatewayDependencies,
): Array<{ name: string; description: string }> {
  return Object.values(deps.adapters)
    .map((adapter) => ({ name: adapter.name, description: adapter.description }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

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
  // recovery loop after `serve()` resolves so the API is already
  // listening and the timer delay never blocks startup. Callers that
  // want an immediate sweep can call `gateway.recoverStuck()` themselves.
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
    aiInGroup = await isAiInTopic(deps.db, params.aiId, params.groupId, params.topicId);
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

  // T-0099: a tier-2 request that matches an active standing rule skips the
  // card. This runs only after the policy accepted the request (the AI is
  // active, it belongs to the named group, the args parse), so a stopped AI
  // is never auto-approved and a rule can never widen who or where. The rule
  // is (AI, chat, action)-exact: any mismatch leaves the request on the
  // normal approval path. Eligibility is re-checked here, not only when the
  // rule was created: an adapter that gained an `estimateCost` (or lost
  // `allowAlways`) since then no longer auto-runs.
  if (adapter.allowAlways === true && adapter.estimateCost === undefined) {
    const rule = await findActiveRule(deps.db, {
      aiId: params.aiId,
      groupId: params.groupId ?? null,
      topicId: params.topicId ?? null,
      action: params.action,
    });
    if (rule !== null) {
      return runAutoApprovedAction(deps, params, adapter as ActionAdapter<unknown>, rule.id);
    }
  }

  return runApprovalPath(deps, params, adapter, at);
}

async function runAllowedAction(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
): Promise<RequestOutcome> {
  const parsed = decodeActionArgs(adapter.argsSchema, params.args);
  if (!parsed.ok) {
    // The policy already ran the same decode, so this is a defence in
    // depth. It cannot trip in production but a custom adapter that
    // mutates state between calls could in theory disagree.
    return { status: 'denied', reason: 'invalid_args' };
  }
  const parsedArgs = parsed.value;
  const ctx: ActionContext = {
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    topicId: params.topicId ?? null,
    requestId: 'allow-' + randomUUID(),
  };

  let outcome: 'ok' | 'error';
  let summary: string | null = null;
  let modelText: string | undefined;
  try {
    const result: ActionResult = await adapter.execute(ctx, parsedArgs);
    outcome = 'ok';
    summary = truncateSummary(result.summary);
    modelText = sanitiseModelText(result.modelText);
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
  // `modelText` rides back to the model only: it is never stored on a row
  // (there is no row on this path), never audited, never announced below.
  return outcome === 'ok' && summary !== null
    ? modelText === undefined
      ? { status: 'executed', summary }
      : { status: 'executed', summary, modelText }
    : { status: 'failed' };
}

// T-0099: a tier-2 request that matches an active standing rule runs
// immediately, like the allow path. The AI must still be `active`
// (checked by `runRequest` before this function is reached) and the
// adapter must still be always-eligible (`allowAlways: true` and no
// `estimateCost`) — both enforced at the gateway entry. We never write
// an approval row, never post a card, and the audit carries the rule id
// as the `subject` so a reader can join the rule to the action.
async function runAutoApprovedAction(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  ruleId: string,
): Promise<RequestOutcome> {
  const parsed = decodeActionArgs(adapter.argsSchema, params.args);
  if (!parsed.ok) {
    // Defence in depth: invalid args fall through to the normal
    // approval path. We do this by reporting the same denial the
    // allow path would; the policy has the same order, but a custom
    // adapter that mutates state between calls could in theory
    // disagree.
    return { status: 'denied', reason: 'invalid_args' };
  }
  const parsedArgs = parsed.value;
  const ctx: ActionContext = {
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    topicId: params.topicId ?? null,
    requestId: 'rule-' + ruleId,
  };

  let outcome: 'ok' | 'error';
  let summary: string | null = null;
  let modelText: string | undefined;
  try {
    const result: ActionResult = await adapter.execute(ctx, parsedArgs);
    outcome = 'ok';
    summary = truncateSummary(result.summary);
    modelText = sanitiseModelText(result.modelText);
  } catch (error) {
    outcome = 'error';
    // Adapter error text is never stored, never returned, never logged
    // with the message. The class name is logged for ops.
    deps.logger.warn(
      { err: errorName(error), action: params.action, aiId: params.aiId, ruleId },
      'action adapter threw under auto-approval',
    );
  }

  // The args hash is computed over the parsed args so an audit reader
  // can join back to the request without ever seeing the args.
  const hash = argsHash(parsedArgs);
  if (!ARGS_HASH_PATTERN.test(hash)) {
    // Defence in depth: if canonical hashing rejects the args we
    // never ran anything we could not audit. Practically unreachable.
    return { status: 'denied', reason: 'invalid_args' };
  }

  // Two audit entries: `action.auto_approved` (subject = rule id) and
  // `action.executed` / `action.failed` (subject = null, no rule
  // attached) so the existing audit queries continue to surface every
  // action outcome regardless of how it was authorised.
  await deps.audit.record({
    actorUserId: null,
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    action: 'action.auto_approved',
    subjectId: ruleId,
    argsHash: hash,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: null,
  });
  await writeAllowAudit(deps, params, outcome);

  // The chat sees the outcome with the "Ran automatically" prefix the
  // spec asks for, so the owner can tell the card was skipped.
  await safeAnnounce(deps, {
    outcome: {
      aiId: params.aiId,
      groupId: params.groupId ?? null,
      ...(params.topicId === undefined ? {} : { topicId: params.topicId }),
      status: outcome === 'ok' ? 'executed' : 'failed',
      summary:
        outcome === 'ok' && summary !== null
          ? `Ran automatically (always allowed in this chat): ${summary}`
          : null,
    },
  });

  return outcome === 'ok' && summary !== null
    ? modelText === undefined
      ? { status: 'executed', summary }
      : { status: 'executed', summary, modelText }
    : { status: 'failed' };
}

async function runApprovalPath(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  at: Date,
): Promise<RequestOutcome> {
  const parsed = decodeActionArgs(adapter.argsSchema, params.args);
  if (!parsed.ok) {
    return { status: 'denied', reason: 'invalid_args' };
  }
  // T-0132: an adapter may bind server-side state into the stored args
  // before the hash is computed (card-time hosts read from the DB). The
  // hook runs before policy-relevant checks below so a stale card can
  // never be described or stored; a throw (e.g. a missing tool) becomes
  // the gateway's generic `failed`, never a leak and never `denied`.
  let parsedArgs: unknown = parsed.value;
  if (adapter.prepareArgs !== undefined) {
    const prepareCtx: ActionContext = {
      aiId: params.aiId,
      groupId: params.groupId ?? null,
      topicId: params.topicId ?? null,
      requestId: 'prepare-' + randomUUID(),
    };
    try {
      parsedArgs = await adapter.prepareArgs(prepareCtx, parsed.value);
    } catch (error) {
      deps.logger.warn(
        { err: errorName(error), action: params.action, aiId: params.aiId },
        'action adapter prepareArgs threw',
      );
      return { status: 'failed' };
    }
  }
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

  // This one transaction stays on drizzle: it passes `tx` to
  // `createApproval` (still a drizzle transaction client) and inserts the
  // `pending_actions` row on the same `tx`, so it moves when the approvals
  // service moves to `effect/sql` (C1 in `docs/audit/effect-sql-migration.md`).
  // Every other statement in this module runs on `effect/sql`.

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
          ...(params.topicId === undefined ? {} : { topicId: params.topicId }),
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
        topicId: params.topicId ?? null,
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
    approvalRequested: {
      aiId: params.aiId,
      groupId: params.groupId ?? null,
      ...(params.topicId === undefined ? {} : { topicId: params.topicId }),
      approvalId,
    },
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
  const [pending] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PendingActionRow>`SELECT * FROM pending_actions
        WHERE approval_id = ${approvalId} LIMIT 1`;
    }),
  );
  if (!pending) {
    return;
  }
  if (pending.status !== 'waiting') {
    return;
  }
  const [approval] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        status: string;
        expiresAt: Date;
      }>`SELECT status, expires_at FROM approvals
        WHERE id = ${approvalId} LIMIT 1`;
    }),
  );
  if (!approval) {
    return;
  }

  // Re-check the AI status: a stop between request and approval must
  // cancel the action. The approval service has already accepted the
  // human's decision; the kill switch wins here.
  const [ai] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiStatusRow>`SELECT id, status FROM ais
        WHERE id = ${pending.aiId} LIMIT 1`;
    }),
  );
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
    const [postVerify] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ status: string }>`SELECT status FROM approvals
          WHERE id = ${approvalId} LIMIT 1`;
      }),
    );
    if (postVerify?.status !== 'consumed') {
      await cancelPending(deps, pending, 'denied', at);
    }
    return;
  }

  // The race-safe claim. Exactly one caller wins; the loser sees zero rows
  // updated and returns silently. After this point a crash leaves it
  // `running`, which `recoverStuck` reports — never re-executes.
  const claimed = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PendingActionRow>`UPDATE pending_actions
        SET status = 'running', started_at = ${at}
        WHERE id = ${pending.id} AND status = 'waiting'
        RETURNING *`;
    }),
  );
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
        ...(pending.topicId === null ? {} : { topicId: pending.topicId }),
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
        topicId: pending.topicId,
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
      ...(pending.topicId === null ? {} : { topicId: pending.topicId }),
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
        return yield* sql<{
          id: string;
          expiresAt: Date;
          status: string;
        }>`SELECT id, expires_at, status FROM approvals
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

async function cancelPending(
  deps: ActionGatewayDependencies,
  row: PendingActionRow,
  reason: 'denied' | 'ai_not_active',
  at: Date,
): Promise<void> {
  const updated = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<PendingActionRow>`UPDATE pending_actions
        SET status = 'cancelled', finished_at = ${at}
        WHERE id = ${row.id} AND status = 'waiting'
        RETURNING *`;
    }),
  );
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
      ...(row.topicId === null ? {} : { topicId: row.topicId }),
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
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE pending_actions
        SET status = ${status}, result_summary = ${summary}, finished_at = ${at}
        WHERE id = ${row.id} AND status = 'running'`;
    }),
  );
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
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiStatusRow>`SELECT id, status FROM ais
        WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function isAiInGroup(db: ServerDatabase, aiId: string, groupId: string): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${groupId} AND ai_id = ${aiId} LIMIT 1`;
    }),
  );
  return row !== undefined;
}

// T-0110: a request with a `groupId` must carry a `topicId` that belongs to
// that group and to a room the AI is a member of (`topic_ais`, or General
// via `group_ais`). Anything else — a missing topic, a topic of another
// group, a topic the AI was never added to — denies with the existing
// `ai_not_in_group` reason.
async function isAiInTopic(
  db: ServerDatabase,
  aiId: string,
  groupId: string,
  topicId: string | undefined,
): Promise<boolean> {
  if (topicId === undefined) {
    return false;
  }
  const [topic] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        id: string;
        groupId: string;
        visibility: 'public' | 'private';
        isGeneral: boolean;
        archivedAt: Date | null;
      }>`SELECT id, group_id, visibility, is_general, archived_at FROM topics
        WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  // The topic must belong to the group and be live: an archived topic's
  // room is gone (the AI left it), so nothing may fire there anymore.
  if (!topic || topic.groupId !== groupId || topic.archivedAt !== null) {
    return false;
  }
  if (topic.isGeneral) {
    return isAiInGroup(db, aiId, groupId);
  }
  // T-0109 rule: in a private topic the AI counts only while its owner is a
  // topic member, so an AI that lost its room cannot still raise requests.
  return (await allowedTopicAiIds(db, topic)).has(aiId);
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

// Sanitises an adapter's `modelText` for the `executed` outcome: stripped
// of the wrapper's closing tag, truncated at 16 KiB. `undefined` (the
// adapter returned none) stays `undefined` so the outcome carries no key.
// Never called for `failed` outcomes — a throw has no `modelText`, and a
// post-approval `execute` return is not forwarded to any model.
function sanitiseModelText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return truncateModelText(stripModelTextCloseTag(value));
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
      topicId?: string;
      approvalId: string;
    };
    outcome?: {
      aiId: string;
      groupId: string | null;
      topicId?: string;
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
