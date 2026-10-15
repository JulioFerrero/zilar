// Topic view builders: turn `TopicRow`s into the shapes routes return. Split
// out of `./access` (T-1121) so both files stay under the 400-line limit. The
// access checks live in `./access`.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupRoleRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { rolesOfTopic, topicRoleHolderIds } from '../roles/service';
import type { TopicAiView, TopicOwnerView, TopicView } from './access';

export async function countTopicMembers(db: ServerDatabase, topic: TopicRow): Promise<number> {
  // T-1492: a public topic is the whole group — its people and its AIs.
  if (topic.visibility !== 'private') {
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT (
          (SELECT count(*) FROM group_members WHERE group_id = ${topic.groupId})
          + (SELECT count(*) FROM group_ais WHERE group_id = ${topic.groupId})
        )::int AS total`;
      }),
    );
    return row?.total ?? 0;
  }
  // T-0116: `topic_members` plus the holders of its roles (still group
  // members). A holder who is also a direct member counts once.
  // T-1492: a private topic adds the AIs it lists in `topic_ais`.
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

export async function resolveOwnerName(
  db: ServerDatabase,
  topic: TopicRow,
): Promise<TopicOwnerView | null> {
  if (topic.ownerUserId !== null) {
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // `user` is reserved, so it is quoted.
        return yield* sql<{ id: string; name: string }>`SELECT id, name FROM "user"
          WHERE id = ${topic.ownerUserId}
          LIMIT 1`;
      }),
    );
    if (!row) {
      return null;
    }
    return { kind: 'user', id: row.id, name: row.name };
  }
  if (topic.ownerAiId !== null) {
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string; name: string }>`SELECT id, name FROM ais
          WHERE id = ${topic.ownerAiId}
          LIMIT 1`;
      }),
    );
    if (!row) {
      return null;
    }
    return { kind: 'ai', id: row.id, name: row.name };
  }
  return null;
}

function buildTopicView(
  topic: TopicRow,
  mucDomain: string,
  parts: {
    memberCount: number;
    owner: TopicOwnerView | null;
    aiList: TopicAiView[];
    roleInfo: Awaited<ReturnType<typeof rolesOfTopic>>;
  },
): TopicView {
  const { memberCount, owner, aiList, roleInfo } = parts;
  return {
    id: topic.id,
    groupId: topic.groupId,
    name: topic.name,
    glyph: topic.glyph,
    chatJid: `${topic.roomLocalpart}@${mucDomain}`,
    visibility: topic.visibility,
    kind: topic.kind,
    status: topic.status,
    owner,
    linkUrl: topic.linkUrl,
    linkLabel: topic.linkLabel,
    isGeneral: topic.isGeneral,
    archived: topic.archivedAt !== null,
    memberCount,
    ais: aiList,
    roles: roleInfo.roles,
    approverRole: roleInfo.approverRole,
  };
}

export async function toTopicView(
  db: ServerDatabase,
  topic: TopicRow,
  mucDomain: string,
): Promise<TopicView> {
  const [memberCount, owner, aiList, roleInfo] = await Promise.all([
    countTopicMembers(db, topic),
    resolveOwnerName(db, topic),
    listTopicAis(db, topic.id),
    rolesOfTopic(db, topic.id, topic.groupId),
  ]);
  return buildTopicView(topic, mucDomain, { memberCount, owner, aiList, roleInfo });
}

// The AIs added to one topic, sorted by name. Rows exist only for
// non-General topics; General membership is `group_ais`.
export async function listTopicAis(db: ServerDatabase, topicId: string): Promise<TopicAiView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string }>`SELECT a.id, a.name
        FROM topic_ais ta
        INNER JOIN ais a ON a.id = ta.ai_id
        WHERE ta.topic_id = ${topicId}`;
    }),
  );
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

interface TopicViewParts {
  memberCounts: Map<string, number>;
  owners: Map<string, TopicOwnerView | null>;
  ais: Map<string, TopicAiView[]>;
  roles: Map<string, Awaited<ReturnType<typeof rolesOfTopic>>>;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(key(row)) ?? [];
    list.push(row);
    grouped.set(key(row), list);
  }
  return grouped;
}

// The same four lookups as `toTopicView`, run once for all `rows` with `IN`
// queries and joined in memory by topic id.
async function loadTopicViewParts(db: ServerDatabase, rows: TopicRow[]): Promise<TopicViewParts> {
  const topicIds = rows.map((row) => row.id);
  const groupIds = [...new Set(rows.map((row) => row.groupId))];
  const privateIds = rows.filter((row) => row.visibility === 'private').map((row) => row.id);
  const ownerUserIds = [
    ...new Set(rows.flatMap((row) => (row.ownerUserId ? [row.ownerUserId] : []))),
  ];
  const ownerAiIds = [
    ...new Set(
      rows.flatMap((row) => (row.ownerUserId === null && row.ownerAiId ? [row.ownerAiId] : [])),
    ),
  ];
  const [
    accessRows,
    memberRows,
    roleRows,
    directRows,
    userRows,
    aiOwnerRows,
    aiRows,
    groupAiRows,
    approverRows,
  ] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* Effect.all([
        sql<{ topicId: string; roleId: string }>`SELECT topic_id, role_id FROM topic_role_access
            WHERE topic_id IN ${sql.in(topicIds)}`,
        sql<{ groupId: string; userId: string }>`SELECT group_id, user_id FROM group_members
            WHERE group_id IN ${sql.in(groupIds)}`,
        sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id IN ${sql.in(groupIds)}`,
        privateIds.length === 0
          ? Effect.succeed([] as Array<{ topicId: string; userId: string }>)
          : sql<{ topicId: string; userId: string }>`SELECT topic_id, user_id FROM topic_members
                WHERE topic_id IN ${sql.in(privateIds)}`,
        ownerUserIds.length === 0
          ? Effect.succeed([] as Array<{ id: string; name: string }>)
          : sql<{ id: string; name: string }>`SELECT id, name FROM "user"
                WHERE id IN ${sql.in(ownerUserIds)}`,
        ownerAiIds.length === 0
          ? Effect.succeed([] as Array<{ id: string; name: string }>)
          : sql<{ id: string; name: string }>`SELECT id, name FROM ais
                WHERE id IN ${sql.in(ownerAiIds)}`,
        sql<{ topicId: string; id: string; name: string }>`SELECT ta.topic_id, a.id, a.name
            FROM topic_ais ta
            INNER JOIN ais a ON a.id = ta.ai_id
            WHERE ta.topic_id IN ${sql.in(topicIds)}`,
        // T-1492: a public topic's count adds the group's AIs.
        sql<{
          groupId: string;
          total: number;
        }>`SELECT group_id, count(*)::int AS total FROM group_ais
            WHERE group_id IN ${sql.in(groupIds)} GROUP BY group_id`,
        sql<{ id: string; approverRoleId: string | null }>`SELECT id, approver_role_id FROM topics
            WHERE id IN ${sql.in(topicIds)}`,
      ]);
    }),
  );

  const membersByGroup = new Map(
    [...groupBy(memberRows, (row) => row.groupId)].map(
      ([groupId, list]) => [groupId, new Set(list.map((row) => row.userId))] as const,
    ),
  );
  const rolesByGroup = groupBy(roleRows, (row) => row.groupId);
  const roleIdsByTopic = groupBy(accessRows, (row) => row.topicId);
  const attachedRoleIds = [...new Set(accessRows.map((row) => row.roleId))];
  const holderRows =
    attachedRoleIds.length === 0
      ? []
      : await runSql(
          db,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ roleId: string; userId: string }>`SELECT role_id, user_id
              FROM group_member_roles
              WHERE role_id IN ${sql.in(attachedRoleIds)}`;
          }),
        );
  const holdersByRole = groupBy(holderRows, (row) => row.roleId);
  const directByTopic = groupBy(directRows, (row) => row.topicId);
  const aisByTopic = groupBy(aiRows, (row) => row.topicId);
  const groupAiCounts = new Map(groupAiRows.map((row) => [row.groupId, Number(row.total)]));
  const userNames = new Map(userRows.map((row) => [row.id, row.name]));
  const aiNames = new Map(aiOwnerRows.map((row) => [row.id, row.name]));
  const approverByTopic = new Map(approverRows.map((row) => [row.id, row.approverRoleId]));

  const parts: TopicViewParts = {
    memberCounts: new Map(),
    owners: new Map(),
    ais: new Map(),
    roles: new Map(),
  };
  for (const topic of rows) {
    const groupMembers = membersByGroup.get(topic.groupId) ?? new Set<string>();
    const groupAiCount = groupAiCounts.get(topic.groupId) ?? 0;
    const groupRoles = rolesByGroup.get(topic.groupId) ?? [];
    const wanted = new Set((roleIdsByTopic.get(topic.id) ?? []).map((row) => row.roleId));
    const attached = groupRoles.filter((role) => wanted.has(role.id));
    attached.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const holdersOf = (roleId: string) =>
      (holdersByRole.get(roleId) ?? []).filter((row) => groupMembers.has(row.userId));
    const approverId = approverByTopic.get(topic.id);
    const approver = groupRoles.find((role) => role.id === approverId) ?? null;
    parts.roles.set(topic.id, {
      roles: attached.map((role) => ({
        id: role.id,
        name: role.name,
        memberCount: holdersOf(role.id).length,
      })),
      approverRole: approver === null ? null : { id: approver.id, name: approver.name },
    });

    if (topic.visibility !== 'private') {
      parts.memberCounts.set(topic.id, groupMembers.size + groupAiCount);
    } else {
      const ids = new Set((directByTopic.get(topic.id) ?? []).map((row) => row.userId));
      for (const role of attached) {
        for (const row of holdersOf(role.id)) {
          ids.add(row.userId);
        }
      }
      parts.memberCounts.set(topic.id, ids.size + (aisByTopic.get(topic.id)?.length ?? 0));
    }

    let owner: TopicOwnerView | null = null;
    if (topic.ownerUserId !== null) {
      const name = userNames.get(topic.ownerUserId);
      owner = name === undefined ? null : { kind: 'user', id: topic.ownerUserId, name };
    } else if (topic.ownerAiId !== null) {
      const name = aiNames.get(topic.ownerAiId);
      owner = name === undefined ? null : { kind: 'ai', id: topic.ownerAiId, name };
    }
    parts.owners.set(topic.id, owner);

    parts.ais.set(
      topic.id,
      (aisByTopic.get(topic.id) ?? [])
        .map((row) => ({ id: row.id, name: row.name }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    );
  }
  return parts;
}

export async function toTopicViews(
  db: ServerDatabase,
  rows: TopicRow[],
  mucDomain: string,
): Promise<TopicView[]> {
  if (rows.length === 0) {
    return [];
  }
  const parts = await loadTopicViewParts(db, rows);
  const views = rows.map((topic) =>
    buildTopicView(topic, mucDomain, {
      memberCount: parts.memberCounts.get(topic.id) ?? 0,
      owner: parts.owners.get(topic.id) ?? null,
      aiList: parts.ais.get(topic.id) ?? [],
      roleInfo: parts.roles.get(topic.id) ?? { roles: [], approverRole: null },
    }),
  );
  views.sort((a, b) => {
    if (a.isGeneral !== b.isGeneral) {
      return a.isGeneral ? -1 : 1;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return views;
}
