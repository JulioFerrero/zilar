// The batched topic-visibility pass for the chat list (T-1175). It answers the
// same question as `visibleTopics` in `./access` for many groups at once: the
// non-archived topics of each group the caller is a member of, with private
// topics kept only through a `topic_members` row or a role (T-0116). Every read
// runs once with `sql.in(...)` over all ids, so a user in N groups costs a fixed
// handful of queries instead of a handful per group.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';

// The visible topics of each requested group, keyed by group id. A group the
// caller is not a member of maps to an empty list, like `visibleTopics` would
// answer for it, so the caller never sees a group it may not.
export async function visibleTopicsForGroups(
  db: ServerDatabase,
  groupIds: string[],
  userId: string,
): Promise<Map<string, TopicRow[]>> {
  const visible = new Map<string, TopicRow[]>();
  for (const groupId of groupIds) {
    visible.set(groupId, []);
  }
  if (groupIds.length === 0) {
    return visible;
  }

  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id IN ${sql.in(groupIds)}`;
    }),
  );
  const active = rows.filter((row) => row.archivedAt === null);
  if (active.length === 0) {
    return visible;
  }

  // One membership read for all ids, matching the existence check in
  // `getGroupMembership` (access.ts) — a row for (group, user) means a member.
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string }>`SELECT group_id FROM group_members
        WHERE group_id IN ${sql.in(groupIds)} AND user_id = ${userId}`;
    }),
  );
  const memberOf = new Set(memberRows.map((row) => row.groupId));

  const privateIds = active
    .filter((row) => row.visibility === 'private' && memberOf.has(row.groupId))
    .map((row) => row.id);
  const privateSeen = new Set<string>();
  if (privateIds.length > 0) {
    // Private topics reached through a direct `topic_members` row.
    const directRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_members
          WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${userId}`;
      }),
    );
    for (const row of directRows) {
      privateSeen.add(row.topicId);
    }
    // T-0116: topics reached through a role, not a direct row.
    const roleRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT tra.topic_id FROM topic_role_access tra
          INNER JOIN group_member_roles gmr ON gmr.role_id = tra.role_id
          WHERE tra.topic_id IN ${sql.in(privateIds)} AND gmr.user_id = ${userId}`;
      }),
    );
    for (const row of roleRows) {
      privateSeen.add(row.topicId);
    }
  }

  for (const row of active) {
    if (!memberOf.has(row.groupId)) {
      continue;
    }
    if (row.visibility === 'private' && !privateSeen.has(row.id)) {
      continue;
    }
    visible.get(row.groupId)?.push(row);
  }
  return visible;
}
