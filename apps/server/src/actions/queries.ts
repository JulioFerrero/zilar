import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { verifyApproval } from '../approvals/service';
import type { AuditEntry } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { AisRow, ApprovalRow, GroupAiRow, PendingActionRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { allowedTopicAiIds } from '../topics/access';
import type { ActionGatewayDependencies, RequestParams } from './gateway';
import type { ActionResult } from './registry';
import { errorName, safeAnnounce, truncateSummary } from './support';

// Internal row shapes. Extracted so the implementation does not lean on the
// schema inference for places where we hand-pick columns.
type AiStatusRow = Pick<AisRow, 'id' | 'status'>;

export async function cancelPending(
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

export async function writeAllowAudit(
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

export async function readAiStatus(db: ServerDatabase, aiId: string): Promise<AiStatusRow | null> {
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
      return yield* sql<Pick<GroupAiRow, 'aiId'>>`SELECT ai_id FROM group_ais
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
export async function isAiInTopic(
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
      return yield* sql<
        Pick<TopicRow, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>
      >`SELECT id, group_id, visibility, is_general, archived_at FROM topics
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

// Wired into the approvals POST `/decision` route. Idempotent: a second
// caller for an already-decided approval finds the pending row already
// moved on and returns silently. Safe to call concurrently: the
// conditional `waiting → running` update makes exactly one caller win.
export async function runOnApprovalDecided(
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
      return yield* sql<
        Pick<ApprovalRow, 'status' | 'expiresAt'>
      >`SELECT status, expires_at FROM approvals
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
        return yield* sql<Pick<ApprovalRow, 'status'>>`SELECT status FROM approvals
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
