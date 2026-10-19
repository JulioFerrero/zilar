import { Effect } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { canDecide, canDecideMany } from './access';
import type { ApprovalStatus, PublicApproval } from './schemas';
import { type ApprovalRow } from '../db/rows-agents';

// The driver may hand back `timestamptz` as ISO strings; `toApprovalRow`
// normalises them so the rest of the module keeps the `ApprovalRow` type.
export type ApprovalSqlRow = Omit<ApprovalRow, 'decidedAt' | 'expiresAt' | 'createdAt'> & {
  decidedAt: Date | string | null;
  expiresAt: Date | string;
  createdAt: Date | string;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function toApprovalRow(raw: ApprovalSqlRow): ApprovalRow {
  return {
    ...raw,
    decidedAt: raw.decidedAt === null ? null : toDate(raw.decidedAt),
    expiresAt: toDate(raw.expiresAt),
    createdAt: toDate(raw.createdAt),
  };
}

// One query for the batch. A departed member is never named, and one role's
// holders fan out to every topic sharing it.
export async function approverNamesForTopics(
  db: ServerDatabase,
  topicIds: Array<string | null>,
): Promise<Map<string, string[]>> {
  const unique = [...new Set(topicIds.filter((id): id is string => id !== null))];
  const names = new Map<string, string[]>();
  if (unique.length === 0) {
    return names;
  }
  const topicRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; approverRoleId: string | null }>`SELECT * FROM topics
        WHERE id IN ${sql.in(unique)}`;
    }),
  );
  const withRole = topicRows.filter((topic) => topic.approverRoleId !== null);
  if (withRole.length === 0) {
    return names;
  }
  const roleToTopics = new Map<string, string[]>();
  for (const topic of withRole) {
    const roleId = topic.approverRoleId as string;
    const list = roleToTopics.get(roleId) ?? [];
    list.push(topic.id);
    roleToTopics.set(roleId, list);
  }
  const holderRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string; name: string; userId: string }>`SELECT
          gmr.role_id, u.name, u.id AS user_id
        FROM group_member_roles gmr
        INNER JOIN "user" u ON u.id = gmr.user_id
        INNER JOIN group_roles gr ON gr.id = gmr.role_id
        INNER JOIN group_members gm
          ON gm.group_id = gr.group_id AND gm.user_id = gmr.user_id
        WHERE gmr.role_id IN ${sql.in([...roleToTopics.keys()])}`;
    }),
  );
  const byTopic = new Map<string, Array<{ name: string; userId: string }>>();
  for (const row of holderRows) {
    const topicIds = roleToTopics.get(row.roleId) ?? [];
    for (const topicId of topicIds) {
      const list = byTopic.get(topicId) ?? [];
      list.push({ name: row.name, userId: row.userId });
      byTopic.set(topicId, list);
    }
  }
  for (const [topicId, holders] of byTopic) {
    holders.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    names.set(
      topicId,
      holders.map((holder) => holder.name),
    );
  }
  return names;
}

// The user's own AIs plus groups they administer, only for topics they can
// see. Newest first, capped at 100.
export async function listDecidableApprovals(
  db: ServerDatabase,
  userId: string,
  now: Date,
): Promise<PublicApproval[]> {
  const allowedAiIds = await decidableAiIdsForUser(db, userId);
  const allowedGroupIds = await decidableGroupIdsForUser(db, userId);

  if (allowedAiIds.length === 0 && allowedGroupIds.length === 0) {
    return [];
  }

  const rawRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const conditions: Array<Statement.Fragment> = [];
      if (allowedAiIds.length > 0) {
        conditions.push(
          sql.and([
            sql`status = 'pending'`,
            sql`expires_at > ${now}`,
            sql`ai_id IN ${sql.in(allowedAiIds)}`,
          ]),
        );
      }
      if (allowedGroupIds.length > 0) {
        conditions.push(
          sql.and([
            sql`status = 'pending'`,
            sql`expires_at > ${now}`,
            sql`group_id IN ${sql.in(allowedGroupIds)}`,
          ]),
        );
      }
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE ${sql.or(conditions)}
        ORDER BY created_at DESC LIMIT 100`;
    }),
  );
  const rows = rawRows.map(toApprovalRow);
  // Drop rows outside the viewer's visible topics, so a blind admin never counts
  // a private topic in the badge.
  const approverNames = await approverNamesForTopics(
    db,
    rows.map((row) => row.topicId),
  );
  const decisions = await canDecideMany(db, rows, userId);
  const visible = [];
  for (const row of rows) {
    if (decisions.get(row.id) === true) {
      visible.push(toPublicApproval(row, now, false, null, approverNamesFor(row, approverNames)));
    }
  }
  return visible;
}

function approverNamesFor(row: { topicId: string | null }, names: Map<string, string[]>): string[] {
  return row.topicId === null ? [] : (names.get(row.topicId) ?? []);
}

// Visible only to a user who may decide it; a past-due `pending` row reads as
// `expired` without a write.
export async function getDecidableApproval(
  db: ServerDatabase,
  approvalId: string,
  userId: string,
  now: Date,
): Promise<PublicApproval | null> {
  const [rawRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ApprovalSqlRow>`SELECT * FROM approvals
        WHERE id = ${approvalId} LIMIT 1`;
    }),
  );
  if (!rawRow) {
    return null;
  }
  const row = toApprovalRow(rawRow);
  if (!(await canDecide(db, row, userId))) {
    return null;
  }
  const names = await approverNamesForTopics(db, [row.topicId]);
  return toPublicApproval(row, now, false, null, approverNamesFor(row, names));
}

// Marks past-due `pending` rows `denied` with `note = 'expired'`, so the read
// model and a hard `pending` query agree. The conditional `WHERE` keeps a
// concurrent decision from being overwritten.
export async function expireStale(
  db: ServerDatabase,
  now: Date,
): Promise<Array<{ id: string; aiId: string; groupId: string | null }>> {
  const updated = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; aiId: string; groupId: string | null }>`UPDATE approvals
          SET status = 'denied', decided_at = ${now}, note = 'expired'
        WHERE status = 'pending' AND expires_at < ${now}
        RETURNING id, ai_id, group_id`;
    }),
  );
  return updated.map((row) => ({ id: row.id, aiId: row.aiId, groupId: row.groupId }));
}

async function decidableAiIdsForUser(db: ServerDatabase, userId: string): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais WHERE owner = ${userId}`;
    }),
  );
  return rows.map((row) => row.id);
}

async function decidableGroupIdsForUser(db: ServerDatabase, userId: string): Promise<string[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE user_id = ${userId} AND role IN ('owner', 'admin')`;
    }),
  );
  return rows.map((row) => row.groupId);
}

// A past-due `pending` row and a sweeper-denied one both read as `expired`, so
// nobody sees "Denied" for a request nobody denied. `decided_by` is omitted,
// and the route supplies `alwaysEligible` and the visible names.
export function toPublicApproval(
  row: ApprovalRow,
  now: Date,
  alwaysEligible: boolean = false,
  topicName: string | null = null,
  approverNames: string[] = [],
): PublicApproval {
  const isPending = row.status === 'pending';
  const sweptByTimer = row.status === 'denied' && row.note === 'expired' && row.decidedBy === null;
  const status: ApprovalStatus | 'expired' =
    sweptByTimer || (isPending && row.expiresAt.getTime() <= now.getTime())
      ? 'expired'
      : row.status;

  const hasWorstCase = row.worstCaseCurrency !== null && row.worstCaseAmount !== null;
  const worstCase = hasWorstCase
    ? {
        currency: row.worstCaseCurrency as 'EUR' | 'USD',
        amount: Number(row.worstCaseAmount),
      }
    : null;

  return {
    id: row.id,
    aiId: row.aiId,
    groupId: row.groupId,
    topicId: row.topicId,
    topicName,
    approverNames,
    action: row.action,
    summary: row.summary,
    details: row.details,
    argsHash: row.argsHash,
    worstCase,
    requestedBy: row.requestedBy,
    status,
    decidedAt: row.decidedAt,
    note: row.note,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    alwaysEligible,
  };
}
