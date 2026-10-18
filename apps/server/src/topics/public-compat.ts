import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

// A public topic includes nobody until people join, while General stays
// everyone; the reads follow that rule and the writes do too. A new public
// topic starts with only its creator, and a group member joins no public
// topic until they join one. Existing topics keep their backfilled
// members.
export const PUBLIC_TOPICS_START_EMPTY = true;

// The members a new public topic starts with: only its creator, otherwise
// every current group member (the creator included).
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

// Adds newcomers to every existing public non-General topic of the group.
// A no-op while `PUBLIC_TOPICS_START_EMPTY` is set. Must run after the
// membership insert commits and before the room sync reads the rows.
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
