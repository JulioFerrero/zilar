// effect-plain: runRequest and its helpers; the Effect approval path moved to approval-path.ts (size split)
import { randomUUID } from 'node:crypto';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';
import { findActiveRule } from '../approvals/rules';
import { argsHash } from './canonical';
import { runApprovalPath } from './approval-path';
import type { ActionGatewayDependencies, RequestOutcome, RequestParams } from './gateway';
import { policy } from './policy';
import { isAiInTopic, readAiStatus, writeAllowAudit } from './queries';
import {
  decodeActionArgs,
  type ActionAdapter,
  type ActionContext,
  type ActionResult,
} from './registry';
import { errorName, safeAnnounce, sanitiseModelText, truncateSummary } from './support';

export { APPROVAL_TTL_MS, MAX_STORED_ARGS_BYTES } from './approval-path';

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
    const executed = await executeAction(deps, params, adapter as ActionAdapter<unknown>, null);
    if (executed === null) {
      return { status: 'denied', reason: 'invalid_args' };
    }
    await writeAllowAudit(deps, params, executed.run.outcome);
    return executed.run.response;
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

  // T-1655: a scheduled run has no person to approve a card, so a tier-2
  // request that reached this point (no matching standing rule) is refused
  // with `needs_approval` instead of parking a card nobody will see. Tier 0/1
  // and the standing-rule auto-approval above returned earlier and are
  // unchanged; like every policy denial this writes no approval row and
  // announces nothing.
  if (params.unattended === true) {
    return { status: 'denied', reason: 'needs_approval' };
  }

  return runApprovalPath(deps, params, adapter, at);
}

interface AdapterRun {
  outcome: 'ok' | 'error';
  response: RequestOutcome;
}

// Runs one adapter and maps its result. The error text is never stored,
// returned or logged with the message: only the error class name is logged,
// for ops.
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
  // `modelText` and `posted` ride back to the model only: never stored on a
  // row, never audited, never announced.
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

// Decodes the args and runs the adapter with the request's context. Null means
// the args failed to decode; the caller answers the denial the policy would.
async function executeAction(
  deps: ActionGatewayDependencies,
  params: RequestParams,
  adapter: ActionAdapter<unknown>,
  ruleId: string | null,
): Promise<{ parsedArgs: unknown; run: AdapterRun } | null> {
  const parsed = decodeActionArgs(adapter.argsSchema, params.args);
  // The policy already ran the same decode: this is defence in depth for a
  // custom adapter that mutates state between calls.
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
  const executed = await executeAction(deps, params, adapter, ruleId);
  if (executed === null) {
    return { status: 'denied', reason: 'invalid_args' };
  }
  const { run } = executed;

  // The args hash is computed over the parsed args so an audit reader
  // can join back to the request without ever seeing the args.
  const hash = argsHash(executed.parsedArgs);
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
  await writeAllowAudit(deps, params, run.outcome);

  // The chat sees the outcome with the "Ran automatically" prefix the
  // spec asks for, so the owner can tell the card was skipped.
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
