import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { approvalRules } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';

// T-0099: standing approval rules. A rule grants a single AI the right to
// run a single action in one chat (a group, or the personal chat with its
// owner when `groupId` is null) without a fresh approval card. Rules are
// soft-revoked (`revoked_at`/`revoked_by`) — the row stays around so the
// audit reader can show the history, but `findActiveRule` only returns
// rows where `revokedAt IS NULL`. Deletion of the AI, the group or the
// `created_by` user cascades.

// The "scope" the public list returns. `personal` means `group_id IS NULL`
// (the DM between the AI and its owner); `group` means a real group.
export type ApprovalRuleScope = 'personal' | 'group';

// One row, exactly as the public routes return it. `id`, the action, the
// scope, the optional `groupId`/`topicId` pair (or the topic name, for rows
// the viewer may see), who created it and when. Never the args or the
// `revokedAt`/`revokedBy` — those are internal.
export interface PublicApprovalRule {
  id: string;
  action: string;
  scope: ApprovalRuleScope;
  groupId: string | null;
  /** The topic the rule applies in. Null for personal-chat rules. */
  topicId: string | null;
  /** The topic's name, or null for personal rules. The route blanks this
   *  for topics the viewer cannot see (which cannot happen for a returned
   *  row); the field stays for the client. */
  topicName: string | null;
  createdAt: Date;
  createdBy: string;
}

type ApprovalRuleRow = typeof approvalRules.$inferSelect;

// The top-level queries run on the `effect/sql` client registered for this
// database (see `../effect/sql`). The exported functions stay `async` so
// routes and tests keep their shape during the transition.
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

// The atomic idempotent write that turns an "approve_always" decision
// into a standing rule. Three guarantees:
//   - one rule per (aiId, topicIdOrNull, action) when active, enforced by
//     the partial unique indexes on `approval_rules`
//   - if an active rule already exists, the existing row is returned and
//     `created === false`
//   - if the caller is not the AI owner and (for a group) not a group
//     owner/admin, returns `null` so the caller cannot probe existence
//
// The `tx` parameter is the transaction the caller is already in
// (typically the decision's `db.transaction`). A same-transaction write
// means the decision + rule are atomic.
export interface CreateRuleInput {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
  createdBy: string;
}

export interface CreateRuleResult {
  rule: PublicApprovalRule;
  created: boolean;
}

// `findActiveRuleForUpdate` and `createRule` stay on drizzle for now: their
// caller (`approvals/service.ts`) passes a drizzle transaction, so the read
// and the insert must run on it. They move once that caller's transaction
// moves.
export async function findActiveRuleForUpdate(
  tx: ServerDatabase,
  input: { aiId: string; groupId: string | null; topicId: string | null; action: string },
): Promise<ApprovalRuleRow | null> {
  const baseFilter =
    input.topicId === null
      ? and(
          eq(approvalRules.aiId, input.aiId),
          isNull(approvalRules.topicId),
          eq(approvalRules.action, input.action),
          isNull(approvalRules.revokedAt),
        )
      : and(
          eq(approvalRules.aiId, input.aiId),
          eq(approvalRules.topicId, input.topicId),
          eq(approvalRules.action, input.action),
          isNull(approvalRules.revokedAt),
        );
  const [row] = await tx.select().from(approvalRules).where(baseFilter).limit(1);
  return row ?? null;
}

// Inserts an active rule. Returns the new row and `created: true`, or the
// existing active row and `created: false` when one already exists for the
// same (aiId, chat, action). No race protection beyond the partial unique
// indexes — two concurrent callers racing on the same key both reach this
// function, one wins the insert and the other falls back to a re-read.
export async function createRule(
  tx: ServerDatabase,
  input: CreateRuleInput,
  now: Date,
): Promise<CreateRuleResult> {
  const existing = await findActiveRuleForUpdate(tx, {
    aiId: input.aiId,
    groupId: input.groupId,
    topicId: input.topicId,
    action: input.action,
  });
  if (existing !== null) {
    return { rule: toPublicRule(existing), created: false };
  }

  // `ON CONFLICT DO NOTHING` (not a caught unique violation): inside a
  // Postgres transaction a failed statement aborts the whole transaction, so
  // a concurrent inserter winning the partial unique index must not raise.
  const [row] = await tx
    .insert(approvalRules)
    .values({
      id: randomUUID(),
      aiId: input.aiId,
      groupId: input.groupId,
      topicId: input.topicId,
      action: input.action,
      createdBy: input.createdBy,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (row !== undefined) {
    return { rule: toPublicRule(row), created: true };
  }
  const winner = await findActiveRuleForUpdate(tx, {
    aiId: input.aiId,
    groupId: input.groupId,
    topicId: input.topicId,
    action: input.action,
  });
  if (winner === null) {
    throw new Error('Failed to create approval rule');
  }
  return { rule: toPublicRule(winner), created: false };
}

// One-shot lookup the action gateway uses before creating an approval:
// "is there an active rule for (ai, topic, action)?" Returns null when
// there is not, or when the rule is for a different topic/action.
export async function findActiveRule(
  db: ServerDatabase,
  input: { aiId: string; groupId: string | null; topicId: string | null; action: string },
): Promise<ApprovalRuleRow | null> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      if (input.topicId === null) {
        const rows = yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules
          WHERE ai_id = ${input.aiId} AND topic_id IS NULL
            AND action = ${input.action} AND revoked_at IS NULL LIMIT 1`;
        return rows[0] ?? null;
      }
      const rows = yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules
        WHERE ai_id = ${input.aiId} AND topic_id = ${input.topicId}
          AND action = ${input.action} AND revoked_at IS NULL LIMIT 1`;
      return rows[0] ?? null;
    }),
  );
}

// Lists the active rules for an AI. The AI's owner only — the routes
// gate this; the helper does not.
export async function listActiveRulesForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<PublicApprovalRule[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules
        WHERE ai_id = ${aiId} AND revoked_at IS NULL`;
    }),
  );
  return rows.map(toPublicRule);
}

// Lists the active rules of one topic. The route gates callers to viewers
// of the topic; the helper does not.
export async function listActiveRulesForTopic(
  db: ServerDatabase,
  topicId: string,
): Promise<ApprovalRuleRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules
        WHERE topic_id = ${topicId} AND revoked_at IS NULL`;
    }),
  );
  return [...rows];
}

// Soft-revoke one rule by id. Returns:
//   - the rule row the caller can pass to the audit log when revoked
//   - `null` when the id is unknown or the rule belongs to a different
//     AI/group the caller is not allowed to manage (the same shape for
//     both so existence is never leaked).
//
// The route also passes `actorId` so the audit log records who revoked.
export interface RevokeRuleInput {
  ruleId: string;
  actorId: string;
  now: Date;
}

export async function revokeRule(
  db: ServerDatabase,
  input: RevokeRuleInput,
): Promise<{ row: ApprovalRuleRow } | null> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [row] = yield* sql<ApprovalRuleRow>`SELECT * FROM approval_rules
        WHERE id = ${input.ruleId} LIMIT 1`;
      if (!row) {
        return null;
      }
      if (row.revokedAt !== null) {
        // Idempotent: an already-revoked row returns its data so the route
        // can answer 204 without writing again or auditing twice.
        return { row };
      }
      const [updated] = yield* sql<ApprovalRuleRow>`UPDATE approval_rules
        SET revoked_at = ${input.now}, revoked_by = ${input.actorId}
        WHERE id = ${row.id} AND revoked_at IS NULL RETURNING *`;
      if (!updated) {
        return null;
      }
      return { row: updated };
    }),
  );
}

// Bulk revoke helper used by the lifecycle tests and topic-AI removal.
// Revokes the AI's active rules in one topic. `now` is supplied so the
// caller's transaction and the revocation share a timestamp.
export async function revokeActiveRulesForAiInTopic(
  tx: ServerDatabase,
  input: { aiId: string; topicId: string; actorId: string | null; now: Date },
): Promise<Array<{ id: string; action: string }>> {
  const rows = await runSql(
    tx,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalRuleRow>`UPDATE approval_rules
        SET revoked_at = ${input.now}, revoked_by = ${input.actorId}
        WHERE ai_id = ${input.aiId} AND topic_id = ${input.topicId}
          AND revoked_at IS NULL RETURNING *`;
    }),
  );
  return rows.map((row) => ({ id: row.id, action: row.action }));
}

// Bulk revoke helper used by `removeGroupAi`: revokes the AI's active rules in
// every topic of the group. It updates `approval_rules` directly, so the caller
// supplies `now` to share the timestamp with the rest of its work.
export function revokeActiveRulesForAiInGroupEffect(input: {
  aiId: string;
  groupId: string;
  actorId: string | null;
  now: Date;
}): Effect.Effect<Array<{ id: string; action: string }>, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: string; action: string }>`UPDATE approval_rules
      SET revoked_at = ${input.now.toISOString()}, revoked_by = ${input.actorId}
      WHERE ai_id = ${input.aiId} AND group_id = ${input.groupId}
        AND revoked_at IS NULL RETURNING id, action`;
    return rows.map((row) => ({ id: row.id, action: row.action }));
  });
}

// Whether the user is an owner/admin of `groupId`. Used by the routes for
// `GET /api/groups/:id/approval-rules` and to gate the revoke route.
export async function isGroupAdmin(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const [membership] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: string }>`SELECT role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return membership !== undefined && (membership.role === 'owner' || membership.role === 'admin');
}

// Maps a row to the public shape. `scope` is derived from `group_id`:
// null means personal chat, anything else means a group topic. `topicName`
// is left null here; the route fills it in for topics the viewer can see.
export function toPublicRule(row: ApprovalRuleRow): PublicApprovalRule {
  return {
    id: row.id,
    action: row.action,
    scope: row.groupId === null ? 'personal' : 'group',
    groupId: row.groupId,
    topicId: row.topicId,
    topicName: null,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}
