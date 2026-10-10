import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { syncTopicRoom } from '../topics/rooms';
import type { RolesServiceDeps } from './schemas';

// Re-syncs every non-archived topic room of the group that grants access to
// any of `roleIds`. Best effort per room (logged with the group id, never a
// topic name): the database is the source of truth.
export async function syncTopicsWithRoles(
  deps: RolesServiceDeps,
  groupId: string,
  roleIds: string[],
): Promise<void> {
  if (roleIds.length === 0) {
    return;
  }
  const topicRows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  const accessRows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ topicId: string; roleId: string }>`SELECT topic_id, role_id
        FROM topic_role_access
        WHERE role_id IN ${sql.in(roleIds)}`;
    }),
  );
  const wanted = new Set(accessRows.map((row) => row.topicId));
  for (const topic of topicRows) {
    if (topic.archivedAt !== null || !wanted.has(topic.id)) {
      continue;
    }
    try {
      await syncTopicRoom(
        { db: deps.db, adminClient: deps.adminClient, domain: deps.domain, logger: deps.logger },
        topic,
      );
    } catch {
      deps.logger.warn({ groupId }, 'could not sync a topic room after a role change');
    }
  }
}
