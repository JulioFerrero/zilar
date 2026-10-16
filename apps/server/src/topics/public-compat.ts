import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

// T-1762: Julio's rule (2026-10-16, docs/design/mockups/topic-people/README.md
// "Round 2") is that a public topic includes nobody until people join, while
// General stays everyone. The reads already follow that rule (T-1757), but the
// Join UI does not exist yet, so while this switch is `false` the writes keep
// the old behaviour: a new public topic starts with every group member and a
// new group member joins every public topic. That way main can be deployed at
// any time and users see no change. The Join UI batch (web W9 and phone W10 in
// docs/plan/topic-people.md) sets this to `true`.
export const PUBLIC_TOPICS_START_EMPTY = false;

// The members a new public topic starts with: only its creator once the Join UI
// ships, otherwise every current group member of the group (the creator is one
// of them) so a fresh topic still holds the whole group.
export async function initialPublicMemberIds(
  db: ServerDatabase,
  groupId: string,
  creatorId: string,
  startEmpty: boolean = PUBLIC_TOPICS_START_EMPTY,
): Promise<string[]> {
  if (startEmpty) {
    return [creatorId];
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id AS "userId" FROM group_members
        WHERE group_id = ${groupId}`;
    }),
  );
  const ids = rows.map((row) => row.userId);
  return ids.includes(creatorId) ? ids : [creatorId, ...ids];
}

// Adds the newcomers to every existing public non-General topic of the group.
// A no-op while `PUBLIC_TOPICS_START_EMPTY` is set: the Join UI is what lets a
// person join a topic, so until it ships nobody should land in one by joining
// the group. Must run after the `group_members` insert commits and before the
// topic room sync, so the sync reads the new `topic_members` rows.
export async function addToPublicTopics(
  db: ServerDatabase,
  groupId: string,
  userIds: string[],
  startEmpty: boolean = PUBLIC_TOPICS_START_EMPTY,
): Promise<void> {
  if (startEmpty || userIds.length === 0) {
    return;
  }
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO topic_members (topic_id, user_id, added_by)
        SELECT t.id, u.id, u.id
        FROM topics t
        CROSS JOIN unnest(${userIds}::text[]) AS u(id)
        WHERE t.group_id = ${groupId}
          AND t.visibility = 'public'
          AND t.is_general IS FALSE
          AND t.archived_at IS NULL
        ON CONFLICT DO NOTHING`;
    }),
  );
}
