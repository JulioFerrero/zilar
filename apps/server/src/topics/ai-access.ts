// AI-in-topic access. Split out of `./access` (T-1546) so both files stay under
// the 400-line limit; `./access` re-exports these.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { topicRoleHolderIds } from '../roles/service';
import { getGroupMembership, isTopicMember } from './access';

// Whether an AI may currently be in a topic's room: the derived rule that
// keeps an AI from reading a conversation its owner cannot see. T-1757: only
// General is the whole group, and General has no `topic_ais` rows, so for
// every other topic a `topic_ais` row counts only while the AI's owner is a
// topic member (`topic_members` or a role holder) who is still in the group.
// When the owner leaves the
// topic, the AI drops out of the room automatically, and comes back when the
// owner joins again. The rows are never deleted: this is evaluated live, so
// it can never drift.
export async function aiMayBeInTopic(
  db: ServerDatabase,
  topic: TopicRow,
  ai: { id: string; owner: string; status: string },
): Promise<boolean> {
  if (topic.isGeneral || topic.archivedAt !== null || ai.status !== 'active') {
    return false;
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM topic_ais
        WHERE topic_id = ${topic.id} AND ai_id = ${ai.id}
        LIMIT 1`;
    }),
  );
  if (!row) {
    return false;
  }
  // T-1757: a non-General topic of either visibility allows the AI only while
  // its owner is a topic member. `canSeeTopic` cannot be used here: it stays
  // true for every group member on a public topic.
  if (!(await isTopicMember(db, topic.id, ai.owner))) {
    return false;
  }
  // The owner must still be in the group too, like `allowedTopicAiIds`, so a
  // half-finished leave cannot make the two AI rules disagree.
  return (await getGroupMembership(db, topic.groupId, ai.owner)) !== null;
}

// The AI ids currently allowed in one topic under `aiMayBeInTopic`: the
// fast path for the gateway listing, which needs the allowed set per AI.
// Takes the narrow slice of the topic row the rule reads, so callers with a
// partial select (like the gateway listing) can pass it directly.
export async function allowedTopicAiIds(
  db: ServerDatabase,
  topic: Pick<TopicRow, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>,
): Promise<Set<string>> {
  if (topic.isGeneral || topic.archivedAt !== null) {
    return new Set();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        aiId: string;
        owner: string;
        status: string;
      }>`SELECT ta.ai_id, a.owner, a.status
        FROM topic_ais ta
        INNER JOIN ais a ON a.id = ta.ai_id
        WHERE ta.topic_id = ${topic.id}`;
    }),
  );
  const active = rows.filter((row) => row.status === 'active');
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topic.id}`;
    }),
  );
  const memberIds = new Set(memberRows.map((row) => row.userId));
  // T-0116: an owner who reaches the non-General topic only through a role
  // keeps their AI in the room, like the room sync does.
  for (const holder of await topicRoleHolderIds(db, topic.id, topic.groupId)) {
    memberIds.add(holder);
  }
  const groupRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${topic.groupId}`;
    }),
  );
  const groupIds = new Set(groupRows.map((row) => row.userId));
  return new Set(
    active
      .filter((row) => memberIds.has(row.owner) && groupIds.has(row.owner))
      .map((row) => row.aiId),
  );
}
