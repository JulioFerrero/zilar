import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { ApprovalRuleRow } from '../db/rows';
import { runSql } from '../effect/sql';

// A rule grants one AI one action in one chat without a fresh approval card.
// Rules are soft-revoked so the audit history survives; only `revokedAt IS
// NULL` counts as active.

// `personal` means the DM between the AI and its owner; `group` a real group.
export type ApprovalRuleScope = 'personal' | 'group';

// Never the args or `revokedAt`/`revokedBy`: those are internal.
export interface PublicApprovalRule {
  id: string;
  action: string;
  scope: ApprovalRuleScope;
  groupId: string | null;
  topicId: string | null;
  /** Null for personal rules; the route blanks it for an invisible topic. */
  topicName: string | null;
  createdAt: Date;
  createdBy: string;
}

// One active rule per (AI, topic, action), enforced by the partial unique
// indexes. An existing rule returns `created: false`; an unauthorized caller
// gets `null`, so existence cannot be probed.
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

export function findActiveRuleEffect(input: {
  aiId: string;
  groupId: string | null;
  topicId: string | null;
  action: string;
}): Effect.Effect<ApprovalRuleRow | null, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
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
  });
}

// Returns the new row with `created: true`, or the existing active row. Two
// racers both reach here; one wins the insert and the other re-reads.
export function createRuleEffect(
  input: CreateRuleInput,
  now: Date,
): Effect.Effect<CreateRuleResult, SqlError.SqlError | Error, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const existing = yield* findActiveRuleEffect({
      aiId: input.aiId,
      groupId: input.groupId,
      topicId: input.topicId,
      action: input.action,
    });
    if (existing !== null) {
      return { rule: toPublicRule(existing), created: false };
    }

    // `ON CONFLICT DO NOTHING`, not a caught violation: a failed statement
    // aborts the whole transaction.
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<ApprovalRuleRow>`INSERT INTO approval_rules
        (id, ai_id, group_id, topic_id, action, created_by, created_at)
      VALUES (
        ${randomUUID()},
        ${input.aiId},
        ${input.groupId},
        ${input.topicId},
        ${input.action},
        ${input.createdBy},
        ${now}
      )
      ON CONFLICT DO NOTHING RETURNING *`;
    const row = rows[0];
    if (row !== undefined) {
      return { rule: toPublicRule(row), created: true };
    }
    const winner = yield* findActiveRuleEffect({
      aiId: input.aiId,
      groupId: input.groupId,
      topicId: input.topicId,
      action: input.action,
    });
    if (winner === null) {
      return yield* Effect.fail(new Error('Failed to create approval rule'));
    }
    return { rule: toPublicRule(winner), created: false };
  });
}

export async function createRule(
  db: ServerDatabase,
  input: CreateRuleInput,
  now: Date,
): Promise<CreateRuleResult> {
  return runSql(db, createRuleEffect(input, now));
}

export async function findActiveRule(
  db: ServerDatabase,
  input: { aiId: string; groupId: string | null; topicId: string | null; action: string },
): Promise<ApprovalRuleRow | null> {
  return runSql(db, findActiveRuleEffect(input));
}

// The routes gate the caller to the AI's owner; the helper does not.
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

// The route gates callers to viewers of the topic; the helper does not.
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

// `null` for an unknown and an unauthorized rule alike, so existence is never
// leaked; the route passes `actorId` for the audit log.
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
        // Idempotent: return the row so the route answers 204 without a second
        // write or audit entry.
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

// `now` is supplied so the caller's transaction and the revocation share a
// timestamp.
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

// Revokes the AI's active rules in every topic of the group; the caller
// supplies `now` to share the timestamp.
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

// `topicName` is left null here; the route fills it in for visible topics.
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
