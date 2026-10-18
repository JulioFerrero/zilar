import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TopicRow } from '../db/rows';
import { xmppUnavailable } from '../errors';
import { runSql } from '../effect/sql';
import { isGroupManagerRole } from '../groups/access';
import { randomRoomLocalpart } from '../groups/service';
import { topicRoleHolderIds } from '../roles/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { getGroupMembership, requireVisibleTopic } from './access';
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
  throw xmppUnavailable();
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
  // T-1757: only General lists the whole group; every other topic lists its
  // `topic_members` plus the holders of its roles.
  if (topic.isGeneral) {
    // T-1992: a channel shows its audience to owners and admins only, the same
    // rule as the group routes (`groups/queries.ts`, `listMembersForViewer`).
    const [group, membership] = await Promise.all([
      runSql(
        deps.db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ kind: 'group' | 'channel' }>`SELECT kind FROM groups
            WHERE id = ${topic.groupId} LIMIT 1`;
        }),
      ),
      getGroupMembership(deps.db, topic.groupId, userId),
    ]);
    const managersOnly =
      group[0]?.kind === 'channel' && (membership === null || !isGroupManagerRole(membership.role));
    const rows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string; name: string }>`
          SELECT group_members.user_id, "user".name
          FROM group_members
          INNER JOIN "user" ON "user".id = group_members.user_id
          WHERE group_members.group_id = ${topic.groupId}
            ${managersOnly ? sql`AND group_members.role IN ('owner', 'admin')` : sql``}`;
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

export async function countTopicMembers(db: ServerDatabase, topic: TopicRow): Promise<number> {
  // T-1757: only General is "the whole group — its people and its AIs" (Julio's
  // rule, 2026-10-16). Every other topic counts its `topic_members` plus role
  // holders and its `topic_ais` rows.
  if (topic.isGeneral) {
    // T-1992: a channel's audience (everyone but owners and admins) stays
    // hidden, like the group members route.
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT (
          (SELECT count(*) FROM group_members
            INNER JOIN groups ON groups.id = group_members.group_id
            WHERE group_members.group_id = ${topic.groupId}
              AND (groups.kind <> 'channel' OR group_members.role IN ('owner', 'admin')))
          + (SELECT count(*) FROM group_ais WHERE group_id = ${topic.groupId})
        )::int AS total`;
      }),
    );
    return row?.total ?? 0;
  }
  // T-0116: `topic_members` plus the holders of its roles (still group
  // members). A holder who is also a direct member counts once.
  // T-1757: every non-General topic adds the AIs it lists in `topic_ais`.
  const [direct, holders, ais] = await Promise.all([
    runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
          WHERE topic_id = ${topic.id}`;
      }),
    ),
    topicRoleHolderIds(db, topic.id, topic.groupId),
    runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM topic_ais
          WHERE topic_id = ${topic.id}`;
      }),
    ),
  ]);
  const ids = new Set(direct.map((row) => row.userId));
  for (const id of holders) {
    ids.add(id);
  }
  return ids.size + (ais[0]?.total ?? 0);
}
