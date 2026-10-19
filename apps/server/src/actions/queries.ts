import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { verifyApproval } from '../approvals/service';
import type { AuditEntry } from '../audit/schema';
import type { ServerDatabase } from '../db/client';
import type { AisRow, GroupAiRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { allowedTopicAiIds } from '../topics/access';
import type { ActionGatewayDependencies, RequestParams } from './gateway';
import type { ActionResult } from './registry';
import { errorName, safeAnnounce, truncateSummary, truncateText } from './support';
import { type ApprovalRow, type PendingActionRow } from '../db/rows-agents';

type AiStatusRow = Pick<AisRow, 'id' | 'status'>;

// Bounded like the card summary, so a future caller cannot post an unbounded string.
const CANCELLED_SUMMARY_MAX = 200;

// Best effort: a failed read or missing row falls back to the fixed notice.
async function approvalSummary(
  deps: ActionGatewayDependencies,
  approvalId: string,
): Promise<string | null> {
  try {
    const [approval] = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<Pick<ApprovalRow, 'summary'>>`SELECT summary FROM approvals
          WHERE id = ${approvalId} LIMIT 1`;
      }),
    );
    const summary = approval?.summary.trim() ?? '';
    return summary.length === 0 ? null : truncateText(summary, CANCELLED_SUMMARY_MAX);
  } catch (error) {
    deps.logger.warn(
      { err: errorName(error), approvalId },
      'approval summary lookup failed; posting the fixed cancelled notice',
    );
    return null;
  }
}

export async function cancelPending(
  deps: ActionGatewayDependencies,
  row: PendingActionRow,
  reason: 'denied' | 'ai_not_active' | 'ai_not_in_topic',
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
  const summary = await approvalSummary(deps, row.approvalId);
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
      summary,
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

// A request with a `groupId` must name a `topicId` in that group and in a room the AI is a member of; anything else denies `ai_not_in_group`.
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
  // The topic must be live: an archived topic's room is gone.
  if (!topic || topic.groupId !== groupId || topic.archivedAt !== null) {
    return false;
  }
  if (topic.isGeneral) {
    return isAiInGroup(db, aiId, groupId);
  }
  // In a private topic the AI counts only while its owner is a member.
  return (await allowedTopicAiIds(db, topic)).has(aiId);
}

// Idempotent and concurrency-safe: the conditional `waiting → running` update makes exactly one caller win.
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

  // A stop between request and approval cancels the action; the kill switch wins over the human decision.
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

  // An AI removed from the room after the request cancels instead of running there.
  if (
    pending.groupId !== null &&
    !(await isAiInTopic(deps.db, pending.aiId, pending.groupId, pending.topicId ?? undefined))
  ) {
    await cancelPending(deps, pending, 'ai_not_in_topic', at);
    return;
  }

  if (approval.status === 'denied' || approval.expiresAt.getTime() <= at.getTime()) {
    await cancelPending(deps, pending, 'denied', at);
    return;
  }
  if (approval.status === 'pending') {
    return;
  }

  const verify = await verifyApproval(deps.db, { approvalId, argsHash: pending.argsHash }, at);
  if (!verify.ok) {
    // `{ ok: false }` covers missing, wrong status, expired, hash mismatch and a peer that already consumed the row.
    // Re-read to tell a lost race (`consumed`, return silently) from a cancel (denied/expired/wrong hash).
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

  // Exactly one caller wins; a crash after this leaves `running`, which `recoverStuck` reports and never re-executes.
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
        logger: deps.logger,
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
  // The card already shows a decided success, so post an outcome message only on failure.
  if (outcome !== 'ok') {
    await safeAnnounce(deps, {
      outcome: {
        aiId: pending.aiId,
        groupId: pending.groupId,
        ...(pending.topicId === null ? {} : { topicId: pending.topicId }),
        status: 'failed',
        summary: null,
      },
    });
  }
}
