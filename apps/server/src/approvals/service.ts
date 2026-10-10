import { randomUUID } from 'node:crypto';
import { Effect, Result, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { ApprovalInsert, ApprovalRow } from '../db/rows';
import { createRuleEffect, isGroupAdmin } from './rules';
import { canDecide, decisionToStatus, safeHashEquals } from './access';
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

// Validates input at the boundary and writes one row. The AI must exist; if
// `groupId` is set, `topicId` must name a topic of that group (both set or
// both absent — personal chat). `expiresAt` must be in the future and at
// most 24 hours ahead. Per-AI pending cap is 50.
//
// The Effect version lets the action gateway yield it inside its
// `sql.withTransaction`, so the approval row and the `pending_actions` row
// commit together. The validation errors are typed `ApprovalServiceError`
// failures (not defects), so callers that catch around the Effect see the
// same error instance the old `throw` produced.
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
      // The topic must belong to the group; the AI's membership of the topic
      // is checked by the gateway before this service is reached.
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

// Async wrapper kept for the routes, the sweeper and the tests during the
// transition (the action gateway yields `createApprovalEffect` directly).
export async function createApproval(
  db: ServerDatabase,
  input: CreateApprovalInput,
  now: Date,
): Promise<ApprovalRow> {
  return runSql(db, createApprovalEffect(input, now));
}

// Atomically decides a pending, unexpired request, but only if `userId` may
// decide it (AI owner, or group owner/admin when the request was raised in a
// group). A user who may not decide gets the same null as a missing id, so
// existence is never leaked. Two racing decisions: the conditional update
// makes exactly one win.
//
// T-0099: when `decision === 'approve_always'` and `alwaysEligible(action)`
// is `true`, an `approval_rules` row is created in the same transaction.
// The decision itself still proceeds: the request runs once (the existing
// `onDecided` path), and the rule applies to future matching requests.
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
  // Authorisation comes first: a caller who may not decide must not learn
  // whether the request is expired or already decided.
  if (!(await canDecide(db, row, params.userId))) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new ApprovalServiceError('expired', 'Approval request has expired');
  }
  if (row.status !== 'pending') {
    throw new ApprovalServiceError('not_pending', 'Approval request has already been decided');
  }

  // T-0099: an "approve_always" decision that cannot create a rule (the
  // action is unknown, the adapter opted out, or the adapter reports a
  // cost) is refused before the row is updated so no state changes.
  // T-0101: for a group approval the decider must also be a group
  // owner/admin; a personal-chat approval needs no group check.
  if (params.decision === 'approve_always') {
    const eligible = params.alwaysEligible ?? (() => false);
    if (!eligible(row.action)) {
      throw new ApprovalServiceError(
        'always_not_allowed',
        `Action "${row.action}" cannot be always-allowed`,
      );
    }
    if (row.groupId !== null && !(await isGroupAdmin(db, row.groupId, params.userId))) {
      throw new ApprovalServiceError(
        'always_requires_admin',
        'Only a group admin can always allow an action in this group',
      );
    }
  }

  // The decision + (optional) rule creation share one transaction. If
  // either fails, both roll back. The decision is one conditional UPDATE; the
  // rule (on approve_always) is inserted on the same `effect/sql` client, so
  // `sql.withTransaction` wraps both.
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
            // A concurrent decision won, or the row expired between our
            // checks and the update. Signal "no row updated" so the caller
            // can re-read and pick the right error.
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
    // A concurrent decision won, or the row expired between our checks and the
    // update. Re-read to give the caller a stable error.
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

export interface ApprovalVerifyResult {
  ok: boolean;
  decision?: ApprovalDecision;
}

// Verifies an approval for the engine. Returns `{ ok: true, decision }` only
// when the request is `approved_once` or `approved_always`, unexpired, and
// `argsHash` matches the stored hash (compared with `timingSafeEqual` so the
// answer cannot be used to recover the hash byte by byte). For both
// approvals the status is flipped to `consumed` with a conditional update so a second
// call fails. Any other state — wrong hash, not decided, denied, expired,
// already consumed — returns `{ ok: false }` with no detail.
//
// `approved_always` is treated like `approved_once` here on purpose: standing
// rules (always-allow for one action across requests) are a separate spec and
// the current behaviour is to make every approval consume.
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
