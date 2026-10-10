import { timingSafeEqual } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { ApprovalRow, TopicRow } from '../db/rows';
import { canSeeTopic, getTopic } from '../topics/access';
import type { ApprovalDecision } from './schemas';

// Whether `userId` may decide `row`: the AI owner, or — when the request
// was raised in a topic — that group's owner or admin who can also see the
// topic. T-0116: or a holder of the topic's approver role who can see the
// topic. A group admin who cannot see a private topic gets the same false
// as a missing id, so existence is never leaked. The AI owner keeps
// deciding only while they can see the topic.
export async function canDecide(
  db: ServerDatabase,
  row: ApprovalRow,
  userId: string,
): Promise<boolean> {
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${row.aiId} LIMIT 1`;
    }),
  );
  if (!ai) {
    return false;
  }
  if (row.topicId !== null) {
    const topic = await getTopic(db, row.topicId);
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      return false;
    }
    // The approver role grants decide rights and nothing else: the holder
    // must see the topic (checked above), and the role never widens AI
    // management, rules or other topics. The join ties the role to the
    // approval's group, so the check is self-sufficient even if a stale
    // membership row ever survived a group leave. (`topicId` set implies
    // `groupId` set by the topic-scope CHECK; the guard below is for the
    // type checker.)
    const approverRoleId = topic.approverRoleId;
    if (approverRoleId !== null && row.groupId !== null) {
      const groupId = row.groupId;
      const [held] = await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ userId: string }>`SELECT gmr.user_id FROM group_member_roles gmr
            INNER JOIN group_roles gr ON gr.id = gmr.role_id
            WHERE gmr.role_id = ${approverRoleId} AND gmr.user_id = ${userId}
              AND gr.group_id = ${groupId} LIMIT 1`;
        }),
      );
      if (held) {
        return true;
      }
    }
  }
  if (ai.owner === userId) {
    return true;
  }
  if (row.groupId === null) {
    return false;
  }
  const groupId = row.groupId;
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

// The same rules as `canDecide` for many rows at once: the AI owners, the
// topics, the user's group roles, topic access and approver-role holdings are
// read in a fixed number of queries, then each row is decided in memory.
// Returns row id -> decision.
export async function canDecideMany(
  db: ServerDatabase,
  rows: ReadonlyArray<ApprovalRow>,
  userId: string,
): Promise<Map<string, boolean>> {
  const decisions = new Map<string, boolean>();
  if (rows.length === 0) {
    return decisions;
  }
  const aiIds = [...new Set(rows.map((row) => row.aiId))];
  const topicIds = [...new Set(rows.flatMap((row) => (row.topicId === null ? [] : [row.topicId])))];
  const aiRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; owner: string }>`SELECT id, owner FROM ais
        WHERE id IN ${sql.in(aiIds)}`;
    }),
  );
  const aiOwners = new Map(aiRows.map((ai) => [ai.id, ai.owner]));
  const topics = new Map<string, TopicRow>();
  if (topicIds.length > 0) {
    const topicRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<TopicRow>`SELECT * FROM topics WHERE id IN ${sql.in(topicIds)}`;
      }),
    );
    for (const topic of topicRows) {
      topics.set(topic.id, topic);
    }
  }
  const groupIds = [
    ...new Set([
      ...rows.flatMap((row) => (row.groupId === null ? [] : [row.groupId])),
      ...[...topics.values()].map((topic) => topic.groupId),
    ]),
  ];
  const memberRoles = new Map<string, string>();
  if (groupIds.length > 0) {
    const memberships = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ groupId: string; role: string }>`SELECT group_id, role
          FROM group_members
          WHERE user_id = ${userId} AND group_id IN ${sql.in(groupIds)}`;
      }),
    );
    for (const membership of memberships) {
      memberRoles.set(membership.groupId, membership.role);
    }
  }
  const privateIds = [...topics.values()]
    .filter((topic) => topic.visibility === 'private' && topic.archivedAt === null)
    .map((topic) => topic.id);
  const privateSeen = new Set<string>();
  if (privateIds.length > 0) {
    const memberRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_members
          WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${userId}`;
      }),
    );
    for (const member of memberRows) {
      privateSeen.add(member.topicId);
    }
    const roleRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT tra.topic_id FROM topic_role_access tra
          INNER JOIN group_member_roles gmr ON gmr.role_id = tra.role_id
          WHERE tra.topic_id IN ${sql.in(privateIds)} AND gmr.user_id = ${userId}`;
      }),
    );
    for (const access of roleRows) {
      privateSeen.add(access.topicId);
    }
  }
  const approverRoleIds = [
    ...new Set(
      [...topics.values()].flatMap((topic) =>
        topic.approverRoleId === null ? [] : [topic.approverRoleId],
      ),
    ),
  ];
  // "roleId:groupId" pairs the user holds, tied to the role's own group.
  const heldApprover = new Set<string>();
  if (approverRoleIds.length > 0) {
    const heldRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roleId: string; groupId: string }>`SELECT gmr.role_id, gr.group_id
          FROM group_member_roles gmr
          INNER JOIN group_roles gr ON gr.id = gmr.role_id
          WHERE gmr.role_id IN ${sql.in(approverRoleIds)} AND gmr.user_id = ${userId}`;
      }),
    );
    for (const held of heldRows) {
      heldApprover.add(`${held.roleId}:${held.groupId}`);
    }
  }
  for (const row of rows) {
    const owner = aiOwners.get(row.aiId);
    if (owner === undefined) {
      decisions.set(row.id, false);
      continue;
    }
    if (row.topicId !== null) {
      const topic = topics.get(row.topicId);
      const sees =
        topic !== undefined &&
        topic.archivedAt === null &&
        memberRoles.has(topic.groupId) &&
        (topic.visibility !== 'private' || privateSeen.has(topic.id));
      if (!sees) {
        decisions.set(row.id, false);
        continue;
      }
      if (
        topic.approverRoleId !== null &&
        row.groupId !== null &&
        heldApprover.has(`${topic.approverRoleId}:${row.groupId}`)
      ) {
        decisions.set(row.id, true);
        continue;
      }
    }
    if (owner === userId) {
      decisions.set(row.id, true);
      continue;
    }
    const role = row.groupId === null ? undefined : memberRoles.get(row.groupId);
    decisions.set(row.id, role === 'owner' || role === 'admin');
  }
  return decisions;
}

// Constant-time hash equality. Different lengths return false without ever
// touching `timingSafeEqual` (which would throw).
export function safeHashEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length === 0 || aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// The wire enum (`approve_once` / `approve_always` / `deny`) and the column
// enum (`approved_once` / `approved_always` / `denied`) are spelled apart on
// purpose, so the API stays in protocol shape while the row stays in storage
// shape.
export function decisionToStatus(
  decision: ApprovalDecision,
): 'approved_once' | 'approved_always' | 'denied' {
  switch (decision) {
    case 'approve_once':
      return 'approved_once';
    case 'approve_always':
      return 'approved_always';
    case 'deny':
      return 'denied';
  }
}
