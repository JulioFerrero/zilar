// Topic visibility and access. Every query runs on the `effect/sql` client
// registered for this database (see `../effect/sql`). The exported functions
// stay `async` so routes and tests keep their shape during the transition.
//
// Rows keep their drizzle shapes: `transformResultNames` camelCases the
// `topics` and `group_members` columns into `TopicRow` and the row types here.

import { Effect, Schema } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupMemberRow, GroupRoleRow, TopicRow } from '../db/rows';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { holdsTopicRole, rolesOfTopic, topicRoleHolderIds } from '../roles/service';

export const topicVisibilitySchema = Schema.Literals(['public', 'private']);
export type TopicVisibility = typeof topicVisibilitySchema.Type;

export const topicKindSchema = Schema.Literals(['chat', 'task', 'bug', 'ui', 'routine']);
export type TopicKind = typeof topicKindSchema.Type;

export const topicStatusSchema = Schema.Literals([
  'open',
  'in_progress',
  'in_review',
  'blocked',
  'done',
]);
export type TopicStatus = typeof topicStatusSchema.Type;

export type { TopicRow };

export interface TopicOwnerView {
  kind: 'user' | 'ai';
  id: string;
  name: string;
}

export interface TopicRoleView {
  id: string;
  name: string;
  memberCount: number;
}

export interface TopicView {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: TopicOwnerView | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  memberCount: number;
  /** AIs added to this topic (never private names). */
  ais: TopicAiView[];
  /** T-0116: roles with access to this topic (empty for public topics). */
  roles: TopicRoleView[];
  /** T-0116: the role whose holders may decide approvals here, if any. */
  approverRole: { id: string; name: string } | null;
}

export interface TopicAiView {
  id: string;
  name: string;
}

const MISSING_TOPIC_MESSAGE = 'Topic not found';
// Byte-identical for a missing topic id and for a topic the caller may not
// see, so ids cannot be probed.
export const TOPIC_NOT_FOUND = {
  status: 404 as const,
  code: 'not_found',
  message: 'Topic not found',
};

export function toMissingTopic(): HttpError {
  return new HttpError(TOPIC_NOT_FOUND.status, TOPIC_NOT_FOUND.code, MISSING_TOPIC_MESSAGE);
}

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

export async function getTopic(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function getGroupMembership(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' } | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupMemberRow>`SELECT * FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId}
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function isPrivateMember(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topicId} AND user_id = ${userId}
        LIMIT 1`;
    }),
  );
  return row !== undefined;
}

// Whether the user may see the topic: group member, topic not archived, and
// (for private topics) a row in `topic_members` or a role in
// `topic_role_access` (T-0116). Never throws for a missing topic: callers
// answer the same 404 either way.
export async function canSeeTopic(
  db: ServerDatabase,
  topic: TopicRow,
  userId: string,
): Promise<boolean> {
  if (topic.archivedAt !== null) {
    return false;
  }
  const membership = await getGroupMembership(db, topic.groupId, userId);
  if (!membership) {
    return false;
  }
  if (topic.visibility !== 'private') {
    return true;
  }
  if (await isPrivateMember(db, topic.id, userId)) {
    return true;
  }
  return holdsTopicRole(db, topic.id, userId);
}

// The same check starting from an id, or false when the topic does not exist.
export async function canSeeTopicById(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<boolean> {
  const topic = await getTopic(db, topicId);
  if (!topic) {
    return false;
  }
  return canSeeTopic(db, topic, userId);
}

export async function requireVisibleTopic(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<TopicRow> {
  const topic = await getTopic(db, topicId);
  if (!topic) {
    throw toMissingTopic();
  }
  if (!(await canSeeTopic(db, topic, userId))) {
    throw toMissingTopic();
  }
  return topic;
}

// Every non-archived topic of the group the user may see.
export async function visibleTopics(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  const active = rows.filter((row) => row.archivedAt === null);
  if (active.length === 0) {
    return [];
  }
  const membership = await getGroupMembership(db, groupId, userId);
  if (!membership) {
    return [];
  }
  const privateIds = active.filter((row) => row.visibility === 'private').map((row) => row.id);
  let privateSeen = new Set<string>();
  if (privateIds.length > 0) {
    const memberRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_members
          WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${userId}`;
      }),
    );
    privateSeen = new Set(memberRows.map((row) => row.topicId));
    // T-0116: topics reached through a role, not a direct row.
    const roleRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT tra.topic_id FROM topic_role_access tra
          INNER JOIN group_member_roles gmr ON gmr.role_id = tra.role_id
          WHERE tra.topic_id IN ${sql.in(privateIds)} AND gmr.user_id = ${userId}`;
      }),
    );
    for (const row of roleRows) {
      privateSeen.add(row.topicId);
    }
  }
  return active.filter((row) => row.visibility !== 'private' || privateSeen.has(row.id));
}

// Managing a topic (rename, kind, visibility, archive, members): the topic
// creator, or a group owner/admin who can also see it. Returns false for a
// missing topic or a caller who may not see it — the routes answer 404.
export async function canManageTopic(
  db: ServerDatabase,
  topic: TopicRow,
  userId: string,
): Promise<boolean> {
  if (topic.archivedAt !== null) {
    return false;
  }
  if (!(await canSeeTopic(db, topic, userId))) {
    return false;
  }
  if (topic.createdBy === userId) {
    return true;
  }
  const membership = await getGroupMembership(db, topic.groupId, userId);
  return membership !== null && membership.role !== 'member';
}

export async function requireManagedTopic(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<TopicRow> {
  const topic = await requireVisibleTopic(db, topicId, userId);
  if (topic.createdBy === userId) {
    return topic;
  }
  const membership = await getGroupMembership(db, topic.groupId, userId);
  if (membership === null || membership.role === 'member') {
    throw new HttpError(
      403,
      'forbidden',
      'Only the topic creator or a group owner or admin can manage it',
    );
  }
  return topic;
}

// Creating a topic: group owner/admin always; plain members only when the
// group allows it.
export async function canCreateTopic(
  db: ServerDatabase,
  groupId: string,
  userId: string,
  membersCanCreateTopics: boolean,
): Promise<boolean> {
  const membership = await getGroupMembership(db, groupId, userId);
  if (!membership) {
    return false;
  }
  if (membership.role !== 'member') {
    return true;
  }
  return membersCanCreateTopics;
}

export async function countTopicMembers(db: ServerDatabase, topic: TopicRow): Promise<number> {
  if (topic.visibility !== 'private') {
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM group_members
          WHERE group_id = ${topic.groupId}`;
      }),
    );
    return row?.total ?? 0;
  }
  // T-0116: `topic_members` plus the holders of its roles (still group
  // members). A holder who is also a direct member counts once.
  const [direct, holders] = await Promise.all([
    runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
          WHERE topic_id = ${topic.id}`;
      }),
    ),
    topicRoleHolderIds(db, topic.id, topic.groupId),
  ]);
  const ids = new Set(direct.map((row) => row.userId));
  for (const id of holders) {
    ids.add(id);
  }
  return ids.size;
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
      parts.memberCounts.set(topic.id, groupMembers.size);
    } else {
      const ids = new Set((directByTopic.get(topic.id) ?? []).map((row) => row.userId));
      for (const role of attached) {
        for (const row of holdersOf(role.id)) {
          ids.add(row.userId);
        }
      }
      parts.memberCounts.set(topic.id, ids.size);
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
