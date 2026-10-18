import { randomUUID } from 'node:crypto';
import { Effect, Result, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { type ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { type ApprovalInsert, type ApprovalRow } from '../db/rows';
import { createRuleEffect } from './rules';
import { canDecide, decisionToStatus, safeHashEquals } from './access';
import { isGroupManager } from '../groups/access';
import { toApprovalRow, type ApprovalSqlRow } from './queries';
import {
  ApprovalServiceError,
  MAX_APPROVAL_EXPIRY_MS,
  MAX_PENDING_APPROVALS_PER_AI,
  INVALID_APPROVAL_REQUEST_MESSAGE,
  parseCreateApprovalInput,
  noteSchema,
  type AlwaysEligiblePredicate,
  type ApprovalDecision,
  type CreateApprovalInput,
  type CreatedApprovalRule,
} from './schemas';
export interface ApprovalVerifyResult {
  ok: boolean;
  decision?: ApprovalDecision;
}

// Only an unexpired `approved_once`/`approved_always` with a matching hash
// verifies, and the hash is compared with `timingSafeEqual` so the answer leaks
// nothing. The conditional flip to `consumed` makes a second call fail. Every
// other state returns `{ ok: false }` with no detail.
export async function verifyApproval(
  db: ServerDatabase,
  params: { approvalId: string; argsHash: string },
  now: Date,
): Promise<ApprovalVerifyResult> {
  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${params.approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return { ok: false };
  }
  const row = toApprovalRow(rawRow);
  if (row.status !== 'approved_once' && row.status !== 'approved_always') {
    return { ok: false };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }
  if (!safeHashEquals(row.argsHash, params.argsHash)) {
    return { ok: false };
  }

  const [consumed] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`UPDATE approvals SET status = 'consumed'
        WHERE id = ${row.id} AND status = ${row.status} RETURNING id`;
    }),
  );
  if (!consumed) {
    return { ok: false };
  }
  return {
    ok: true,
    decision: row.status === 'approved_always' ? 'approve_always' : 'approve_once',
  };
}

// The AI must exist, and `topicId` must name a topic of `groupId` when one is
// set. `expiresAt` is at most 24 hours ahead and the per-AI pending cap is 50.
// An Effect so the gateway can yield it inside its transaction.
export function createApprovalEffect(
  input: CreateApprovalInput,
  now: Date,
): Effect.Effect<
  ApprovalRow,
  SqlError.SqlError | ApprovalServiceError | Error,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const data = yield* Effect.try({
      try: () => parseCreateApprovalInput(input),
      catch: (error) =>
        error instanceof ApprovalServiceError
          ? error
          : new ApprovalServiceError('invalid_request', INVALID_APPROVAL_REQUEST_MESSAGE),
    });

    if (data.expiresAt.getTime() <= now.getTime()) {
      return yield* Effect.fail(
        new ApprovalServiceError('invalid_request', 'expires_at must be in the future'),
      );
    }
    if (data.expiresAt.getTime() - now.getTime() > MAX_APPROVAL_EXPIRY_MS) {
      return yield* Effect.fail(
        new ApprovalServiceError(
          'invalid_request',
          'expires_at must be at most 24 hours in the future',
        ),
      );
    }

    const [ai] = yield* sql<{ id: string }>`SELECT id FROM ais WHERE id = ${data.aiId} LIMIT 1`;
    if (!ai) {
      return yield* Effect.fail(new ApprovalServiceError('invalid_request', 'Unknown AI'));
    }

    if (data.groupId !== undefined) {
      const groupId = data.groupId;
      const [link] = yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${groupId} AND ai_id = ${data.aiId} LIMIT 1`;
      if (!link) {
        return yield* Effect.fail(
          new ApprovalServiceError('ai_not_in_group', 'The AI is not in that topic'),
        );
      }
      // The AI's membership of the topic is checked by the gateway first.
      const [topic] = yield* sql<{ id: string; groupId: string }>`SELECT id, group_id FROM topics
        WHERE id = ${data.topicId as string} LIMIT 1`;
      if (!topic || topic.groupId !== groupId) {
        return yield* Effect.fail(
          new ApprovalServiceError('ai_not_in_group', 'The AI is not in that topic'),
        );
      }
    }

    const [countRow] = yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM approvals
      WHERE ai_id = ${data.aiId} AND status = 'pending'`;
    if (Number(countRow?.total ?? 0) >= MAX_PENDING_APPROVALS_PER_AI) {
      return yield* Effect.fail(
        new ApprovalServiceError(
          'pending_limit',
          `At most ${MAX_PENDING_APPROVALS_PER_AI} pending approvals per AI`,
        ),
      );
    }

    const id = randomUUID();
    const row: ApprovalInsert = {
      id,
      aiId: data.aiId,
      groupId: data.groupId ?? null,
      topicId: data.topicId ?? null,
      action: data.action,
      summary: data.summary,
      details: data.details ?? null,
      argsHash: data.argsHash,
      worstCaseCurrency: data.worstCase?.currency ?? null,
      worstCaseAmount: data.worstCase?.amount.toFixed(2) ?? null,
      requestedBy: data.requestedBy,
      status: 'pending',
      expiresAt: data.expiresAt,
    };
    const [created] = yield* sql<ApprovalSqlRow>`INSERT INTO approvals
        (id, ai_id, group_id, topic_id, action, summary, details, args_hash,
          worst_case_currency, worst_case_amount, requested_by, status, expires_at)
      VALUES (
        ${row.id},
        ${row.aiId},
        ${row.groupId},
        ${row.topicId},
        ${row.action},
        ${row.summary},
        ${row.details},
        ${row.argsHash},
        ${row.worstCaseCurrency},
        ${row.worstCaseAmount},
        ${row.requestedBy},
        ${row.status},
        ${row.expiresAt}
      )
      RETURNING *`;
    if (!created) {
      return yield* Effect.fail(new Error('Failed to create approval'));
    }
    return toApprovalRow(created);
  });
}

export async function createApproval(
  db: ServerDatabase,
  input: CreateApprovalInput,
  now: Date,
): Promise<ApprovalRow> {
  return runSql(db, createApprovalEffect(input, now));
}

// A user who may not decide gets the same null as a missing id, so existence is
// never leaked. Two racing decisions: the conditional update makes exactly one
// win.
export interface DecideApprovalResult {
  row: ApprovalRow;
  rule: CreatedApprovalRule | null;
}

export async function decideApproval(
  db: ServerDatabase,
  params: {
    approvalId: string;
    userId: string;
    decision: ApprovalDecision;
    note?: string;
    alwaysEligible?: AlwaysEligiblePredicate;
  },
  now: Date,
): Promise<DecideApprovalResult | null> {
  const noteResult = Schema.decodeUnknownResult(noteSchema)(params.note);
  if (Result.isFailure(noteResult)) {
    throw new ApprovalServiceError('invalid_request', 'Invalid note');
  }

  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${params.approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return null;
  }
  const row = toApprovalRow(rawRow);
  // Authorization first: no expiring or decided information before it.
  if (!(await canDecide(db, row, params.userId))) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new ApprovalServiceError('expired', 'Approval request has expired');
  }
  if (row.status !== 'pending') {
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }

  // An `approve_always` that cannot create a rule is refused before any state
  // changes. In a group the decider must also be a group owner/admin.
  if (params.decision === 'approve_always') {
    const eligible = params.alwaysEligible ?? (() => false);
    if (!eligible(row.action)) {
      throw new ApprovalServiceError(
        'always_not_allowed',
        `Action "${row.action}" cannot be always-allowed`,
      );
    }
    if (row.groupId !== null && !(await isGroupManager(db, row.groupId, params.userId))) {
      throw new ApprovalServiceError(
        'always_requires_admin',
        'Only a group admin can always allow an action in this group',
      );
    }
  }

  // The decision and the optional rule share one transaction: if either fails,
  // both roll back.
  let createdRule: CreatedApprovalRule | null = null;
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<ApprovalSqlRow>`UPDATE approvals
            SET status = ${decisionToStatus(params.decision)},
                decided_by = ${params.userId},
                decided_at = ${now},
                note = ${params.note ?? null}
            WHERE id = ${row.id} AND status = 'pending' AND expires_at > ${now}
            RETURNING *`;
          const decisionRow = rows[0];
          if (!decisionRow) {
            // A concurrent decision or expiry won; signal "no row updated".
            return undefined;
          }

          if (params.decision === 'approve_always') {
            // The rule shares the decision's transaction: both commit or neither.
            const { rule, created } = yield* createRuleEffect(
              {
                aiId: row.aiId,
                groupId: row.groupId,
                topicId: row.topicId,
                action: row.action,
                createdBy: params.userId,
              },
              now,
            );
            createdRule = {
              id: rule.id,
              action: rule.action,
              groupId: rule.groupId,
              topicId: rule.topicId,
              created,
            };
          }

          return toApprovalRow(decisionRow);
        }),
      );
    }),
  );

  if (!updated) {
    // A concurrent decision or expiry won; re-read for a stable error.
    const [rawFresh] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals WHERE id = ${row.id} LIMIT 1`;
      }),
    );
    if (!rawFresh) {
      return null;
    }
    const fresh = toApprovalRow(rawFresh);
    if (fresh.expiresAt.getTime() <= now.getTime()) {
      throw new ApprovalServiceError('expired', 'Approval request has expired');
    }
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }
  return { row: updated, rule: createdRule };
}

export type {
  AlwaysEligiblePredicate,
  ApprovalDecision,
  ApprovalStatus,
  CreateApprovalInput,
  CreatedApprovalRule,
  PublicApproval,
} from './schemas';
export {
  ApprovalServiceError,
  CreateApprovalInputSchema,
  MAX_APPROVAL_EXPIRY_MS,
  MAX_PENDING_APPROVALS_PER_AI,
} from './schemas';
export {
  approverNamesForTopics,
  expireStale,
  getDecidableApproval,
  listDecidableApprovals,
  toPublicApproval,
} from './queries';
export { canDecide, canDecideMany } from './access';
