import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';
import { findActiveRule } from '../approvals/rules';
import { createApprovalEffect } from '../approvals/service';
import { runSql } from '../effect/sql';
import { argsHash } from './canonical';
import type { ActionGatewayDependencies, RequestOutcome, RequestParams } from './gateway';
import { policy } from './policy';
import { isAiInTopic, readAiStatus, writeAllowAudit } from './queries';
import {
  decodeActionArgs,
  type ActionAdapter,
  type ActionContext,
  type ActionResult,
} from './registry';
import {
  errorName,
  safeAnnounce,
  safeStringify,
  sanitiseModelText,
  truncateSummary,
  truncateText,
} from './support';

// 30 minutes: the spec says a tier-2 card is short-lived. The approvals
// service already enforces the hard 24-hour ceiling above this number, so
// no extra validation is needed in `request`.
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

// 20 KB cap on the serialised stored args. Bigger than this would suggest
// the adapter's schema is wrong; rejecting early keeps the row from
// silently growing.
export const MAX_STORED_ARGS_BYTES = 20 * 1024;

export async function runRequest(
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

  // One transaction: the approval row and the `pending_actions` row commit
  // together or not at all. The approval row carries `args_hash`; the
  // pending-action row carries the exact parsed args. The hash is computed
  // from the parsed args, the approval's `verifyApproval` re-hashes the
  // stored value, and the two must match — `argsHash` here is the only place
  // that gets to touch the args. `createApprovalEffect` fails with an
  // `ApprovalServiceError` (e.g. `pending_limit`), which the catch below maps
  // to a stable reason.
  let approvalId: string;
  try {
    approvalId = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const approval = yield* createApprovalEffect(
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
            return approval.id;
          }),
        );
      }),
    );
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
