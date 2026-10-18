// Topic view builders: turn `TopicRow`s into the shapes routes return. Split
// out of `./access` (T-1121) so both files stay under the 400-line limit. The
// access checks live in `./access`.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerDatabase } from '../db/client';
import type { GroupRoleRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { rolesOfTopic } from '../roles/service';
import type { TopicAiView, TopicOwnerView, TopicView } from './access';

export { countTopicMembers } from './queries';

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
    memberIds: string[];
    owner: TopicOwnerView | null;
    aiList: TopicAiView[];
    roleInfo: Awaited<ReturnType<typeof rolesOfTopic>>;
  },
): TopicView {
  const { memberCount, memberIds, owner, aiList, roleInfo } = parts;
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
    doneAt: topic.doneAt?.toISOString() ?? null,
    memberCount,
    memberIds,
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
  // T-1764: both paths share the one membership and avatar rule.
  return (await toTopicViews(db, [topic], mucDomain))[0]!;
}

// T-1764: the avatar urls of a set of AIs, in one query for the whole set, so
// a read attaches each picture without a query per AI.
export async function aiAvatarUrls(
  db: ServerDatabase,
  aiIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = await avatarIdsByOwner(db, 'ai', [...aiIds]);
  return new Map([...ids].map(([aiId, avatarId]) => [aiId, avatarUrlFor(avatarId)]));
}

// Attaches `avatarUrl` to each AI that has a picture, from the map above.
export function withAiAvatars(ais: TopicAiView[], urls: Map<string, string>): TopicAiView[] {
  return ais.map((ai) => {
    const url = urls.get(ai.id);
    return url === undefined ? ai : { ...ai, avatarUrl: url };
  });
}

// The AIs added to one topic, sorted by name and carrying their pictures.
// Rows exist only for non-General topics; General membership is `group_ais`.
export async function listTopicAis(db: ServerDatabase, topicId: string): Promise<TopicAiView[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; name: string; jid: string }>`SELECT a.id, a.name, a.jid
        FROM topic_ais ta
        INNER JOIN ais a ON a.id = ta.ai_id
        WHERE ta.topic_id = ${topicId}`;
    }),
  );
  const ais = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return withAiAvatars(
    ais,
    await aiAvatarUrls(
      db,
      ais.map((ai) => ai.id),
    ),
  );
}

interface TopicViewParts {
  memberIds: Map<string, string[]>;
  owners: Map<string, TopicOwnerView | null>;
  ais: Map<string, TopicAiView[]>;
  roles: Map<string, Awaited<ReturnType<typeof rolesOfTopic>>>;
  /** T-1764: the group's AI count, so General's `memberCount` can add it. */
  groupAiCounts: Map<string, number>;
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
  // The direct `topic_members` rows are needed for every non-General topic
  // (T-1757); General's members are the group.
  const directMemberTopicIds = rows.filter((row) => !row.isGeneral).map((row) => row.id);
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
    groupKindRows,
    approverRows,
  ] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* Effect.all([
        sql<{ topicId: string; roleId: string }>`SELECT topic_id, role_id FROM topic_role_access
            WHERE topic_id IN ${sql.in(topicIds)}`,
        sql<{ groupId: string; userId: string; role: string }>`SELECT group_id, user_id, role
            FROM group_members WHERE group_id IN ${sql.in(groupIds)}`,
        sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id IN ${sql.in(groupIds)}`,
        directMemberTopicIds.length === 0
          ? Effect.succeed([] as Array<{ topicId: string; userId: string }>)
          : sql<{ topicId: string; userId: string }>`SELECT topic_id, user_id FROM topic_members
                WHERE topic_id IN ${sql.in(directMemberTopicIds)}`,
        ownerUserIds.length === 0
          ? Effect.succeed([] as Array<{ id: string; name: string }>)
          : sql<{ id: string; name: string }>`SELECT id, name FROM "user"
                WHERE id IN ${sql.in(ownerUserIds)}`,
        ownerAiIds.length === 0
          ? Effect.succeed([] as Array<{ id: string; name: string }>)
          : sql<{ id: string; name: string }>`SELECT id, name FROM ais
                WHERE id IN ${sql.in(ownerAiIds)}`,
        sql<{
          topicId: string;
          id: string;
          name: string;
          jid: string;
        }>`SELECT ta.topic_id, a.id, a.name, a.jid
            FROM topic_ais ta
            INNER JOIN ais a ON a.id = ta.ai_id
            WHERE ta.topic_id IN ${sql.in(topicIds)}`,
        // T-1757: only General's count adds the group's AIs.
        sql<{
          groupId: string;
          total: number;
        }>`SELECT group_id, count(*)::int AS total FROM group_ais
            WHERE group_id IN ${sql.in(groupIds)} GROUP BY group_id`,
        sql<{ id: string; kind: 'group' | 'channel' }>`SELECT id, kind FROM groups
            WHERE id IN ${sql.in(groupIds)}`,
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
  // T-1992: a channel keeps its audience off topic views, the same rule as the
  // group members route. Topic views carry no viewer, so owners and admins get
  // the same narrowed list here; the group route still returns everyone to them.
  const channelGroupIds = new Set(
    groupKindRows.filter((row) => row.kind === 'channel').map((row) => row.id),
  );
  const managerIdsByGroup = new Map(
    [...groupBy(memberRows, (row) => row.groupId)].map(
      ([groupId, list]) =>
        [
          groupId,
          new Set(list.filter((row) => row.role !== 'member').map((row) => row.userId)),
        ] as const,
    ),
  );
  const generalAudienceByGroup = new Map(
    [...membersByGroup].map(([groupId, ids]) => {
      const managers = managerIdsByGroup.get(groupId) ?? new Set<string>();
      const audience = channelGroupIds.has(groupId)
        ? [...ids].filter((id) => managers.has(id))
        : [...ids];
      return [groupId, audience] as const;
    }),
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
  // T-1764: every AI of every topic in one picture lookup, so each `ais` row
  // can carry its `avatarUrl`.
  const aiPictures = await aiAvatarUrls(
    db,
    aiRows.map((row) => row.id),
  );
  const groupAiCounts = new Map(groupAiRows.map((row) => [row.groupId, Number(row.total)]));
  const userNames = new Map(userRows.map((row) => [row.id, row.name]));
  const aiNames = new Map(aiOwnerRows.map((row) => [row.id, row.name]));
  const approverByTopic = new Map(approverRows.map((row) => [row.id, row.approverRoleId]));

  const parts: TopicViewParts = {
    memberIds: new Map(),
    owners: new Map(),
    ais: new Map(),
    roles: new Map(),
    groupAiCounts,
  };
  for (const topic of rows) {
    const groupMembers = membersByGroup.get(topic.groupId) ?? new Set<string>();
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

    if (topic.isGeneral) {
      parts.memberIds.set(topic.id, [...(generalAudienceByGroup.get(topic.groupId) ?? [])].sort());
    } else {
      const ids = new Set((directByTopic.get(topic.id) ?? []).map((row) => row.userId));
      for (const role of attached) {
        for (const row of holdersOf(role.id)) {
          ids.add(row.userId);
        }
      }
      parts.memberIds.set(topic.id, [...ids].sort());
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
      withAiAvatars(
        (aisByTopic.get(topic.id) ?? [])
          .map((row) => ({ id: row.id, name: row.name, jid: row.jid }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        aiPictures,
      ),
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
  const views = rows.map((topic) => {
    const memberIds = parts.memberIds.get(topic.id) ?? [];
    // T-1764: `memberCount` is the people plus the AIs (General: the group's).
    const aiCount = topic.isGeneral
      ? (parts.groupAiCounts.get(topic.groupId) ?? 0)
      : (parts.ais.get(topic.id)?.length ?? 0);
    return buildTopicView(topic, mucDomain, {
      memberCount: memberIds.length + aiCount,
      memberIds,
      owner: parts.owners.get(topic.id) ?? null,
      aiList: parts.ais.get(topic.id) ?? [],
      roleInfo: parts.roles.get(topic.id) ?? { roles: [], approverRole: null },
    });
  });
  views.sort((a, b) => {
    if (a.isGeneral !== b.isGeneral) {
      return a.isGeneral ? -1 : 1;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return views;
}
