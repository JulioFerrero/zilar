// AI-in-topic access. Split out of `./access` (T-1546) so both files stay under
// the 400-line limit; `./access` re-exports these.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { topicRoleHolderIds } from '../roles/service';
import { canSeeTopic } from './access';

// Whether an AI may currently be in a topic's room: the derived rule that
// keeps an AI from reading a conversation its owner cannot see. For a public
// non-General topic a `topic_ais` row counts as today (the AI must also be
// active and in the group — checked by the callers). For a private topic the
// row counts only while the AI's owner holds a `topic_members` row for that
// topic (and is still a group member): when the owner is removed from the
// topic, or the topic is made private without the owner in `memberIds`, the
// AI drops out of the room automatically, and comes back when the owner is
// added again. The rows are never deleted: this is evaluated live, so it can
// never drift. General topics have no `topic_ais` rows and always answer
// false here.
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
  if (topic.visibility !== 'private') {
    return true;
  }
  return canSeeTopic(db, topic, ai.owner);
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
  if (topic.visibility !== 'private') {
    return new Set(active.map((row) => row.aiId));
  }
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topic.id}`;
    }),
  );
  const memberIds = new Set(memberRows.map((row) => row.userId));
  // T-0116: an owner who reaches the private topic only through a role
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
