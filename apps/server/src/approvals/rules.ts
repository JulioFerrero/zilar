import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { approvalRules, groupMembers } from '../db/schema';

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
// scope, the optional `groupId`, who created it and when. Never the args
// or the `revokedAt`/`revokedBy` — those are internal.
export interface PublicApprovalRule {
  id: string;
  action: string;
  scope: ApprovalRuleScope;
  groupId: string | null;
  createdAt: Date;
  createdBy: string;
}

type ApprovalRuleRow = typeof approvalRules.$inferSelect;

// The atomic idempotent write that turns an "approve_always" decision
// into a standing rule. Three guarantees:
//   - one rule per (aiId, groupIdOrNull, action) when active, enforced by
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
  action: string;
  createdBy: string;
}

export interface CreateRuleResult {
  rule: PublicApprovalRule;
  created: boolean;
}

export async function findActiveRuleForUpdate(
  tx: ServerDatabase,
  input: { aiId: string; groupId: string | null; action: string },
): Promise<ApprovalRuleRow | null> {
  const baseFilter =
    input.groupId === null
      ? and(
          eq(approvalRules.aiId, input.aiId),
          isNull(approvalRules.groupId),
          eq(approvalRules.action, input.action),
          isNull(approvalRules.revokedAt),
        )
      : and(
          eq(approvalRules.aiId, input.aiId),
          eq(approvalRules.groupId, input.groupId),
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
// function and one wins the insert while the other catches the unique
// violation and falls back to a re-read.
export async function createRule(
  tx: ServerDatabase,
  input: CreateRuleInput,
  now: Date,
): Promise<CreateRuleResult> {
  const existing = await findActiveRuleForUpdate(tx, {
    aiId: input.aiId,
    groupId: input.groupId,
    action: input.action,
  });
  if (existing !== null) {
    return { rule: toPublicRule(existing), created: false };
  }

  const id = randomUUID();
  try {
    const [row] = await tx
      .insert(approvalRules)
      .values({
        id,
        aiId: input.aiId,
        groupId: input.groupId,
        action: input.action,
        createdBy: input.createdBy,
        createdAt: now,
      })
      .returning();
    if (!row) {
      throw new Error('Failed to create approval rule');
    }
    return { rule: toPublicRule(row), created: true };
  } catch (error) {
    // The partial unique index made a concurrent inserter win. Re-read and
    // hand back the existing rule. Anything else bubbles up.
    if (isUniqueViolation(error)) {
      const reread = await findActiveRuleForUpdate(tx, {
        aiId: input.aiId,
        groupId: input.groupId,
        action: input.action,
      });
      if (reread !== null) {
        return { rule: toPublicRule(reread), created: false };
      }
    }
    throw error;
  }
}

// One-shot lookup the action gateway uses before creating an approval:
// "is there an active rule for (ai, chat, action)?" Returns null when
// there is not, or when the rule is for a different chat/action.
export async function findActiveRule(
  db: ServerDatabase,
  input: { aiId: string; groupId: string | null; action: string },
): Promise<ApprovalRuleRow | null> {
  return findActiveRuleForUpdate(db, input);
}

// Lists the active rules for an AI. The AI's owner only — the routes
// gate this; the helper does not.
export async function listActiveRulesForAi(
  db: ServerDatabase,
  aiId: string,
): Promise<PublicApprovalRule[]> {
  const rows = await db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.aiId, aiId), isNull(approvalRules.revokedAt)));
  return rows.map(toPublicRule);
}

// Lists the active rules for a group. The route gates callers to the
// group's owner/admin; the helper does not.
export async function listActiveRulesForGroup(
  db: ServerDatabase,
  groupId: string,
): Promise<PublicApprovalRule[]> {
  const rows = await db
    .select()
    .from(approvalRules)
    .where(and(eq(approvalRules.groupId, groupId), isNull(approvalRules.revokedAt)));
  return rows.map(toPublicRule);
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
  const [row] = await db
    .select()
    .from(approvalRules)
    .where(eq(approvalRules.id, input.ruleId))
    .limit(1);
  if (!row) {
    return null;
  }
  if (row.revokedAt !== null) {
    // Idempotent: an already-revoked row returns its data so the route
    // can answer 204 without writing again or auditing twice.
    return { row };
  }
  const [updated] = await db
    .update(approvalRules)
    .set({ revokedAt: input.now, revokedBy: input.actorId })
    .where(and(eq(approvalRules.id, row.id), isNull(approvalRules.revokedAt)))
    .returning();
  if (!updated) {
    return null;
  }
  return { row: updated };
}

// Bulk revoke helper used by the lifecycle tests and `removeGroupAi`. The
// AI/group pair is unique enough (it's the AI's rules in this group) that
// we don't need to return ids. `now` is supplied so the caller's
// transaction and the revocation share a timestamp.
export async function revokeActiveRulesForAiInGroup(
  tx: ServerDatabase,
  input: { aiId: string; groupId: string; actorId: string | null; now: Date },
): Promise<Array<{ id: string; action: string }>> {
  const rows = await tx
    .update(approvalRules)
    .set({ revokedAt: input.now, revokedBy: input.actorId })
    .where(
      and(
        eq(approvalRules.aiId, input.aiId),
        eq(approvalRules.groupId, input.groupId),
        isNull(approvalRules.revokedAt),
      ),
    )
    .returning();
  return rows.map((row) => ({ id: row.id, action: row.action }));
}

// Whether the user is an owner/admin of `groupId`. Used by the routes for
// `GET /api/groups/:id/approval-rules` and to gate the revoke route.
export async function isGroupAdmin(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return membership !== undefined && (membership.role === 'owner' || membership.role === 'admin');
}

// Maps a row to the public shape. `scope` is derived from `group_id`:
// null means personal chat, anything else means a group.
function toPublicRule(row: ApprovalRuleRow): PublicApprovalRule {
  return {
    id: row.id,
    action: row.action,
    scope: row.groupId === null ? 'personal' : 'group',
    groupId: row.groupId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

// Postgres-style unique-violation detection. PGlite raises a DrizzleQueryError
// wrapping the underlying error; the underlying message contains the SQLSTATE
// `23505`. We keep the check narrow (substring on the message) so it does not
// throw on drivers that wrap errors differently.
function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  const cause =
    'cause' in error && error.cause !== null && typeof error.cause === 'object'
      ? (error.cause as { message?: unknown })
      : null;
  const causeMessage = cause && typeof cause.message === 'string' ? cause.message : '';
  return /23505|duplicate key value|unique constraint/i.test(`${message}\n${causeMessage}`);
}
