import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { runSql } from '../effect/sql';
import { randomRoomLocalpart } from '../groups/service';
import { topicRoleHolderIds } from '../roles/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { requireVisibleTopic } from './access';
import type { TopicServiceDeps } from './schemas';

export async function uniqueRoomLocalpart(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
): Promise<{ localpart: string; roomCreated: boolean }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const localpart = randomRoomLocalpart();
    const [existing] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`
          SELECT id FROM topics WHERE room_localpart = ${localpart} LIMIT 1`;
      }),
    );
    if (existing) {
      continue;
    }
    const created = await adminClient.createRoom(localpart, {
      membersOnly: true,
      persistent: true,
      mam: true,
      anonymous: false,
    });
    return { localpart, roomCreated: created.created };
  }
  throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

// Removes a half-created topic: its member rows first, then the topic row.
export async function deleteTopicRows(db: ServerDatabase, topicId: string): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM topic_members WHERE topic_id = ${topicId}`;
      yield* sql`DELETE FROM topics WHERE id = ${topicId}`;
    }),
  );
}

export async function listTopicMembers(
  deps: Pick<TopicServiceDeps, 'db'>,
  topicId: string,
  userId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const topic = await requireVisibleTopic(deps.db, topicId, userId);
  if (topic.visibility !== 'private') {
    const rows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string; name: string }>`
          SELECT group_members.user_id, "user".name
          FROM group_members
          INNER JOIN "user" ON "user".id = group_members.user_id
          WHERE group_members.group_id = ${topic.groupId}`;
      }),
    );
    return [...rows].sort(
      (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
    );
  }
  // T-0116: direct members plus the holders of the topic's roles (still
  // group members). Everyone holding the topic can see the full list: role
  // membership is not secret.
  const [direct, holders] = await Promise.all([
    runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`
          SELECT user_id FROM topic_members WHERE topic_id = ${topic.id}`;
      }),
    ),
    topicRoleHolderIds(deps.db, topic.id, topic.groupId),
  ]);
  const ids = new Set(direct.map((row) => row.userId));
  for (const id of holders) {
    ids.add(id);
  }
  if (ids.size === 0) {
    return [];
  }
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string; name: string }>`
        SELECT id AS user_id, name FROM "user" WHERE id IN ${sql.in([...ids])}`;
    }),
  );
  // `topic_members` rows for users who left the group no longer count (the
  // room sync drops them too); the join above only returns live users.
  const memberRows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        SELECT user_id FROM group_members WHERE group_id = ${topic.groupId}`;
    }),
  );
  const memberIds = new Set(memberRows.map((row) => row.userId));
  return rows
    .filter((row) => memberIds.has(row.userId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}
