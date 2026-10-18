// effect-plain: runRequest and its helpers.
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
