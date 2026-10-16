import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { topicRoleHolderIds } from '../roles/service';
import { aiMayBeInTopic, type TopicRow } from '../topics/access';
import { syncTopicRoom } from '../topics/rooms';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { emitTopicAi } from './events';
import { notePendingGroupSync } from './room-sync-retry';
import type { InviteLogger } from './schemas';

async function groupTopicRows(db: ServerDatabase, groupId: string): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  return [...rows];
}

// T-0108: re-apply the desired members to every active topic room of the
// group (public topics gain/lose the person; private topics drop anyone
// whose `topic_members` row is gone). Best effort: the database is the
// source of truth, and a failed room call is logged with the group id
// (never a topic name), never thrown, so the group flow that just committed
// is not rolled back by a room hiccup.
export async function syncGroupTopicRooms(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  groupId: string,
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  const rows = await groupTopicRows(db, groupId);
  let failed = false;
  for (const topic of rows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    try {
      await syncTopicRoom({ db, adminClient, domain, logger }, topic);
    } catch {
      failed = true;
      logger.warn({ groupId }, 'could not sync a topic room after a group membership change');
    }
  }
  // T-1180: remember the group so the failed sync is retried until every topic
  // room matches the database again, instead of waiting for the next
  // membership change of the group.
  if (failed) {
    notePendingGroupSync(groupId, { db, adminClient, domain, logger });
  }
}

// T-0109: after a group membership change, every AI that the derived rule
// (`aiMayBeInTopic`) no longer allows in a topic gets an `ai-removed` event
// so a live gateway session leaves the room without waiting for reconcile.
// The `topic_ais` rows stay: re-adding the owner brings the AI back.
export async function emitDroppedGroupTopicAis(db: ServerDatabase, groupId: string): Promise<void> {
  const topicRows = await groupTopicRows(db, groupId);
  for (const topic of topicRows) {
    // T-1757: every non-General topic now follows the derived rule, so a
    // dropped AI is announced for public topics too.
    if (topic.isGeneral || topic.archivedAt !== null) {
      continue;
    }
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string; owner: string; status: string }>`SELECT topic_ais.ai_id,
          ais.owner, ais.status FROM topic_ais
          INNER JOIN ais ON ais.id = topic_ais.ai_id
          WHERE topic_ais.topic_id = ${topic.id}`;
      }),
    );
    for (const row of aiRows) {
      const allowed = await aiMayBeInTopic(db, topic, {
        id: row.aiId,
        owner: row.owner,
        status: row.status,
      });
      if (!allowed) {
        emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId: row.aiId });
      }
    }
  }
}

// T-0108: a private topic with no members left is archived. T-0116: role
// holders count as members — a topic a role still grants access to stays
// alive even with zero direct rows.
export async function archiveDrainedPrivateTopics(
  db: ServerDatabase,
  groupId: string,
): Promise<void> {
  const rows = await groupTopicRows(db, groupId);
  for (const topic of rows) {
    if (topic.archivedAt !== null || topic.visibility !== 'private' || topic.isGeneral) {
      continue;
    }
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM topic_members
          WHERE topic_id = ${topic.id}`;
      }),
    );
    if (Number(row?.total ?? 0) !== 0) {
      continue;
    }
    const holders = await topicRoleHolderIds(db, topic.id, groupId);
    if (holders.size === 0) {
      const now = new Date();
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE topics SET archived_at = ${now}, updated_at = ${now}
            WHERE id = ${topic.id}`;
        }),
      );
    }
  }
}
