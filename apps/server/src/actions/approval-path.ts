import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { ARGS_HASH_PATTERN } from '@zilar/protocol';
import { createApprovalEffect } from '../approvals/service';
import { runSql } from '../effect/sql';
import { argsHash } from './canonical';
import type { ActionGatewayDependencies, RequestOutcome, RequestParams } from './gateway';
import { decodeActionArgs, type ActionAdapter, type ActionContext } from './registry';
import { errorName, safeAnnounce, safeStringify, truncateText } from './support';

// 30 minutes: the spec says a tier-2 card is short-lived. The approvals
// service already enforces the hard 24-hour ceiling above this number, so
// no extra validation is needed in `request`.
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

// 20 KB cap on the serialised stored args. Bigger than this would suggest
// the adapter's schema is wrong; rejecting early keeps the row from
// silently growing.
export const MAX_STORED_ARGS_BYTES = 20 * 1024;

export async function runApprovalPath(
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
  const summary = truncateText(described.summary, 500);

  // One transaction: the approval row and the `pending_actions` row commit
  // together or not at all. The approval row carries `args_hash`; the
  // pending-action row carries the exact parsed args. The hash is computed
  // from the parsed args, the approval's `verifyApproval` re-hashes the
  // stored value, and the two must match — `argsHash` here is the only place
  // that gets to touch the args. `createApprovalEffect` fails with an
  // `ApprovalServiceError` (e.g. `pending_limit`), which the catch below maps
  // to a stable reason.
  let approvalId: string;
  let reused = false;
  try {
    const result = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            // T-1737: an identical request (same AI, action, topic/group and
            // summary) that is still pending reuses its open card instead of
            // parking a second one. Read inside the transaction so the diff
            // is against committed state.
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

  // T-1737: the request reused an open card; nothing new was written and
  // nothing is announced, so the caller sees the same approval id again.
  if (reused) {
    return { status: 'pending_approval', approvalId };
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
