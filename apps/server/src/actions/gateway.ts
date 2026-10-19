import type { ServerCore } from '../app/deps';
import { createHash, randomUUID } from 'node:crypto';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';
import { findActiveRule } from '../approvals/rules';
import { createApprovalEffect } from '../approvals/service';
import { type ActionAnnouncer } from './announce';
import {
  isAiInTopic,
  readAiStatus,
  runOnApprovalDecided,
  cancelPending,
  writeAllowAudit,
} from './queries';
import {
  decodeActionArgs,
  type ActionContext,
  type ActionContextLogger,
  type ActionAdapter,
  type ActionRegistry,
  type ActionResult,
} from './registry';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { startSweepLoop } from '../effect/sweep-loop';
import {
  errorName,
  safeAnnounce,
  safeStringify,
  sanitiseModelText,
  truncateSummary,
  truncateText,
} from './support';
import { type ApprovalRow, type PendingActionRow } from '../db/rows-agents';

// Stable reason codes; these strings end up in audit `detail` and `reason`.
export type PolicyDenialReason =
  | 'unknown_action'
  | 'invalid_args'
  | 'ai_not_active'
  | 'ai_not_in_group'
  // Returned by the gateway, not the policy, for an unattended tier-2 request with no standing rule.
  | 'needs_approval';

export type PolicyVerdict =
  | { kind: 'allow'; tier: 0 | 1 }
  | { kind: 'require_approval'; tier: 2 }
  | { kind: 'deny'; reason: PolicyDenialReason };

// Pure function over its inputs; `aiStatus === null` and a stopped AI both answer `ai_not_active`.
export interface PolicyInput {
  adapter: ActionAdapter<unknown> | null;
  rawArgs: unknown;
  aiStatus: 'active' | 'disabled' | 'stopped' | null;
  aiInGroup: boolean | null;
}

// Checks run in this order, so the caller sees the first reason that trips: unknown action, AI active, AI in group, args parse, tier.
// The tier comes from the registered adapter, so nothing the AI writes can lower it.
export function policy(input: PolicyInput): PolicyVerdict {
  if (input.adapter === null) {
    return { kind: 'deny', reason: 'unknown_action' };
  }
  if (input.aiStatus !== 'active') {
    return { kind: 'deny', reason: 'ai_not_active' };
  }
  if (input.aiInGroup === false) {
    return { kind: 'deny', reason: 'ai_not_in_group' };
  }
  const parsed = decodeActionArgs(input.adapter.argsSchema, input.rawArgs);
  if (!parsed.ok) {
    return { kind: 'deny', reason: 'invalid_args' };
  }
  if (input.adapter.tier <= 1) {
    return { kind: 'allow', tier: input.adapter.tier as 0 | 1 };
  }
  return { kind: 'require_approval', tier: 2 };
}

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

async function runRequest(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  now: () => Date,
): Promise<RequestOutcome> {
  const at = now();
  const adapter = deps.adapters[params.action] ?? null;

  // Cheap adapter lookup first, and the gateway's denial order holds even on a hot path.
  if (adapter === null) {
    return { status: 'denied', reason: 'unknown_action' };
  }

  // Missing AI and every non-`active` status share `ai_not_active`, so existence is never disclosed.
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
    const executed = await executeAction(deps, params, adapter as ActionAdapter<unknown>, null);
    if (executed === null) {
      return { status: 'denied', reason: 'invalid_args' };
    }
    await writeAllowAudit(deps, params, executed.run.outcome);
    return executed.run.response;
  }

  // A tier-2 request matching an active standing rule skips the card; eligibility is re-checked here, not only when the rule was created.
  // The rule is (AI, chat, action)-exact, so any mismatch leaves the request on the normal approval path.
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

  // A scheduled run has no approver, so a tier-2 request without a standing rule is denied `needs_approval` instead of parking a card nobody will see.
  if (params.unattended === true) {
    return { status: 'denied', reason: 'needs_approval' };
  }

  return runApprovalPath(deps, params, adapter, at);
}

interface AdapterRun {
  outcome: 'ok' | 'error';
  response: RequestOutcome;
}

// Only the error class name is logged; the adapter's error text is never stored, returned or logged.
async function runAdapter(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  ctx: ActionContext,
  parsedArgs: unknown,
  ruleId: string | null,
): Promise<AdapterRun> {
  let result: ActionResult;
  try {
    result = await adapter.execute(ctx, parsedArgs);
  } catch (error) {
    deps.logger.warn(
      {
        err: errorName(error),
        action: params.action,
        aiId: params.aiId,
        ...(ruleId === null ? {} : { ruleId }),
      },
      ruleId === null ? 'action adapter threw' : 'action adapter threw under auto-approval',
    );
    return { outcome: 'error', response: { status: 'failed' } };
  }
  const summary = truncateSummary(result.summary);
  const modelText = sanitiseModelText(result.modelText);
  // `modelText` and `posted` go to the model only: never stored, audited or announced.
  return {
    outcome: 'ok',
    response:
      summary === null
        ? { status: 'failed' }
        : {
            status: 'executed',
            summary,
            ...(modelText === undefined ? {} : { modelText }),
            ...(result.posted === true ? { posted: true } : {}),
          },
  };
}

async function executeAction(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  ruleId: string | null,
): Promise<{ parsedArgs: unknown; run: AdapterRun } | null> {
  const parsed = decodeActionArgs(adapter.argsSchema, params.args);
  // Defence in depth: the policy already decoded once; a mutation between calls still fails here.
  if (!parsed.ok) {
    return null;
  }
  const ctx: ActionContext = {
    aiId: params.aiId,
    groupId: params.groupId ?? null,
    topicId: params.topicId ?? null,
    requestId: ruleId === null ? 'allow-' + randomUUID() : 'rule-' + ruleId,
    logger: deps.logger,
  };
  return {
    parsedArgs: parsed.value,
    run: await runAdapter(deps, params, adapter, ctx, parsed.value, ruleId),
  };
}

// A tier-2 request matching an active standing rule runs immediately; the adapter must still be always-eligible.
// The audit carries the rule id as `subject`.
async function runAutoApprovedAction(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  ruleId: string,
): Promise<RequestOutcome> {
  const executed = await executeAction(deps, params, adapter, ruleId);
  if (executed === null) {
    return { status: 'denied', reason: 'invalid_args' };
  }
  const { run } = executed;

  // Hash over parsed args; the audit carries it so a reader can join without seeing the args.
  const hash = argsHash(executed.parsedArgs);
  if (!ARGS_HASH_PATTERN.test(hash)) {
    // Defence in depth: never run something we could not audit.
    return { status: 'denied', reason: 'invalid_args' };
  }

  // Two entries: `action.auto_approved` (subject = rule id) plus `action.executed`/`action.failed` (subject = null).
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
  await writeAllowAudit(deps, params, run.outcome);

  // The "Ran automatically" prefix tells the owner the card was skipped.
  await safeAnnounce(deps, {
    outcome: {
      aiId: params.aiId,
      groupId: params.groupId ?? null,
      ...(params.topicId === undefined ? {} : { topicId: params.topicId }),
      status: run.outcome === 'ok' ? 'executed' : 'failed',
      summary:
        run.response.status === 'executed'
          ? `Ran automatically (always allowed in this chat): ${run.response.summary}`
          : null,
    },
  });

  return run.response;
}
// 30 minutes: short-lived tier-2 card; the approvals service enforces the 24-hour ceiling.
const APPROVAL_TTL_MS = 30 * 60 * 1000;

// 20 KB cap on the serialised stored args; rejecting early keeps the row from growing silently.
const MAX_STORED_ARGS_BYTES = 20 * 1024;

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
  // Adapters may bind server-side state into the args before the hash is computed; a throw becomes the gateway's generic `failed`.
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
  const summary = truncateText(described.summary, 500);

  // The approval row and `pending_actions` commit together; `args_hash` and the stored args must match on re-hash.
  let approvalId: string;
  let reused = false;
  try {
    const result = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            // An identical request still pending reuses its open card; read inside the transaction against committed state.
            const [existing] = yield* sql<{ id: string }>`SELECT id FROM approvals
              WHERE ai_id = ${params.aiId}
                AND action = ${params.action}
                AND status = 'pending'
                AND expires_at > ${at}
                AND summary = ${summary}
                AND topic_id IS NOT DISTINCT FROM ${params.topicId ?? null}
                AND group_id IS NOT DISTINCT FROM ${params.groupId ?? null}
              ORDER BY created_at ASC
              LIMIT 1`;
            if (existing) {
              return { id: existing.id, reused: true };
            }
            const approval = yield* createApprovalEffect(
              {
                aiId: params.aiId,
                ...(params.groupId === undefined ? {} : { groupId: params.groupId }),
                ...(params.topicId === undefined ? {} : { topicId: params.topicId }),
                action: params.action,
                summary,
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
            yield* sql`INSERT INTO pending_actions
                (id, approval_id, ai_id, group_id, topic_id, action, args,
                  args_hash, requested_by, status)
              VALUES (
                ${newPendingId},
                ${approval.id},
                ${params.aiId},
                ${params.groupId ?? null},
                ${params.topicId ?? null},
                ${params.action},
                ${JSON.stringify(parsedArgs)}::jsonb,
                ${hash},
                ${params.requestedBy},
                'waiting'
              )`;
            return { id: approval.id, reused: false };
          }),
        );
      }),
    );
    approvalId = result.id;
    reused = result.reused;
  } catch {
    // The approval service's typed error becomes a stable `denied` reason; anything else is logged and treated as `ai_not_active`, never `internal_error`.
    deps.logger.warn(
      { action: params.action, aiId: params.aiId },
      'failed to create approval+pending-action pair',
    );
    return { status: 'denied', reason: 'ai_not_active' };
  }

  if (reused) {
    return { status: 'pending_approval', approvalId };
  }

  // Audited after commit; the approval id is the subject so the reader can join back to the row.
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

  // Best-effort: a throw never changes the returned outcome.
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

// Thrown for values `JSON.stringify` would coerce or drop (NaN, Infinity, bigint, undefined, functions, symbols).
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

// Canonical JSON for the args hash: keys sorted at every depth, arrays keep order, non-JSON values throw instead of coercing.
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return serialise(value, seen);
}

function serialise(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError('Non-finite numbers are not allowed in canonical JSON');
    }
    // `JSON.stringify` is the spec for number→string: shortest round-tripping repr.
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    throw new CanonicalJsonError('bigint values are not allowed in canonical JSON');
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throw new CanonicalJsonError(`${typeof value} values are not allowed in canonical JSON`);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new CanonicalJsonError('Cycles are not allowed in canonical JSON');
    }
    seen.add(value);
    try {
      const parts = value.map((entry) => serialise(entry, seen));
      return `[${parts.join(',')}]`;
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (seen.has(record)) {
      throw new CanonicalJsonError('Cycles are not allowed in canonical JSON');
    }
    seen.add(record);
    try {
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        // Refuse `undefined` in objects so a bug never changes the hash.
        if (record[key] === undefined) {
          throw new CanonicalJsonError('undefined values are not allowed in canonical JSON');
        }
        parts.push(`${JSON.stringify(key)}:${serialise(record[key], seen)}`);
      }
      return `{${parts.join(',')}}`;
    } finally {
      seen.delete(record);
    }
  }
  throw new CanonicalJsonError(`Unsupported value of type ${typeof value}`);
}

export function argsHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
