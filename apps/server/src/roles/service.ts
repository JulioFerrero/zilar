import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { TopicRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { syncTopicRoom } from '../topics/rooms';
import type { TopicServiceDeps } from '../topics/schemas';
import {
  holdersOfRole,
  requireGroupManager,
  requireGroupMembership,
  requireRoleInGroup,
} from './access';
import {
  MAX_ROLES_PER_GROUP,
  toMissingRole,
  type GroupRoleDetail,
  type GroupRoleRow,
  type GroupRoleView,
} from './schemas';

// A role is a way into every private topic that lists it, so a group manager who
// cannot see one of those topics must not be able to hand the role to anyone,
// themselves included.
const PRIVATE_TOPIC_GRANT_MESSAGE =
  "You can't add people to a role that opens a private topic you're not in";

// Runs on the caller's transaction client, so a refusal writes nothing. The
// visibility expression mirrors `canSeeTopic` for private topics.
function assertRoleGrantAllowed(
  sql: SqlClient.SqlClient,
  roleId: string,
  actorId: string,
  addedUserIds: string[],
): Effect.Effect<void, HttpError | SqlError.SqlError> {
  if (addedUserIds.length === 0) {
    return Effect.void;
  }
  return Effect.gen(function* () {
    const rows = yield* sql<{ id: string }>`SELECT topics.id FROM topics
      INNER JOIN topic_role_access ON topic_role_access.topic_id = topics.id
      WHERE topic_role_access.role_id = ${roleId}
        AND topics.visibility = 'private'
        AND topics.archived_at IS NULL
        AND NOT (
          EXISTS (SELECT 1 FROM group_members
            WHERE group_members.group_id = topics.group_id
              AND group_members.user_id = ${actorId})
          AND (
            EXISTS (SELECT 1 FROM topic_members
              WHERE topic_members.topic_id = topics.id
                AND topic_members.user_id = ${actorId})
            OR EXISTS (
              SELECT 1 FROM topic_role_access AS shared
              INNER JOIN group_member_roles ON group_member_roles.role_id = shared.role_id
              WHERE shared.topic_id = topics.id
                AND group_member_roles.user_id = ${actorId}
            )
          )
        )
      LIMIT 1`;
    if (rows.length > 0) {
      return yield* Effect.fail(new HttpError(403, 'forbidden', PRIVATE_TOPIC_GRANT_MESSAGE));
    }
  });
}
// Re-syncs every non-archived topic room granting access to any `roleIds`. Best
// effort per room, logged with the group id and never a topic name.
async function syncTopicsWithRoles(
  deps: TopicServiceDeps,
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
    await syncTopicRoomQuietly(deps, groupId, topic);
  }
}

function mapRoleError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  // A concurrent create/rename that clashed on the unique name index answers 409
  // like the pre-check, not 503.
  if (isUniqueViolation(error)) {
    return new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  return xmppUnavailable();
}

function listGroupRoles(db: ServerDatabase, groupId: string): Promise<readonly GroupRoleRow[]> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
}

async function syncTopicRoomQuietly(
  deps: TopicServiceDeps,
  groupId: string,
  topic: TopicRow,
): Promise<void> {
  try {
    await syncTopicRoom(
      { db: deps.db, adminClient: deps.adminClient, domain: deps.domain, logger: deps.logger },
      topic,
    );
  } catch {
    deps.logger.warn({ groupId }, 'could not sync a topic room after a role change');
  }
}

function auditEntry(
  groupId: string,
  action: string,
  actorUserId: string,
  subjectId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    actorUserId,
    aiId: null as string | null,
    groupId,
    action,
    subjectId,
    argsHash: null as string | null,
    costCurrency: null as 'EUR' | 'USD' | null,
    costAmount: null as number | null,
    result: 'ok' as const,
    // Ids only, so a private topic's name cannot leak through the log.
    detail: { groupId, ...extra },
  };
}

export async function createRole(
  deps: TopicServiceDeps,
  groupId: string,
  actorId: string,
  name: string,
): Promise<GroupRoleDetail> {
  await requireGroupManager(deps.db, groupId, actorId);
  // The unique index keeps the duplicate check race-safe; the count and the
  // insert share one transaction under a per-group lock, so two creates past the
  // cap cannot both insert.
  const existing = await listGroupRoles(deps.db, groupId);
  if (existing.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  const id = randomUUID();
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${groupId}))`;
            const [counter] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM group_roles WHERE group_id = ${groupId}`;
            if (Number(counter?.total ?? 0) >= MAX_ROLES_PER_GROUP) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'invalid_request',
                  `A group has at most ${MAX_ROLES_PER_GROUP} roles`,
                ),
              );
            }
            yield* sql`INSERT INTO group_roles (id, group_id, name, created_by)
              VALUES (${id}, ${groupId}, ${name}, ${actorId})`;
          }),
        );
      }),
    );
  } catch (error) {
    throw mapRoleError(error);
  }
  const [role] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE id = ${id} LIMIT 1`;
    }),
  );
  if (!role) {
    throw xmppUnavailable();
  }
  if (deps.audit) {
    await deps.audit.record(auditEntry(groupId, 'group.role_created', actorId, role.id));
  }
  return toRoleDetail(deps.db, role);
}

export async function renameRole(
  deps: TopicServiceDeps,
  groupId: string,
  roleId: string,
  actorId: string,
  name: string,
): Promise<GroupRoleDetail> {
  await requireGroupManager(deps.db, groupId, actorId);
  const role = await requireRoleInGroup(deps.db, groupId, roleId);
  const siblings = await listGroupRoles(deps.db, groupId);
  if (siblings.some((row) => row.id !== role.id && row.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  // The unique index owns the race; the clash lands in `mapRoleError` as a 409.
  try {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE group_roles SET name = ${name} WHERE id = ${role.id}`;
      }),
    );
  } catch (error) {
    throw mapRoleError(error);
  }
  const [updated] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE id = ${role.id}`;
    }),
  );
  if (!updated) {
    throw toMissingRole();
  }
  if (deps.audit) {
    await deps.audit.record(auditEntry(groupId, 'group.role_renamed', actorId, role.id));
  }
  return toRoleDetail(deps.db, updated);
}

// Deletes the role everywhere (assignments and topic access cascade, approver
// columns fall back to null) and re-syncs the topics that granted it access.
export async function deleteRole(
  deps: TopicServiceDeps,
  groupId: string,
  roleId: string,
  actorId: string,
): Promise<void> {
  await requireGroupManager(deps.db, groupId, actorId);
  await requireRoleInGroup(deps.db, groupId, roleId);
  // Capture the topics before the cascade removes the rows.
  const accessRows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_role_access
        WHERE role_id = ${roleId}`;
    }),
  );
  const topicIds = [...new Set(accessRows.map((row) => row.topicId))];
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM group_roles WHERE id = ${roleId}`;
    }),
  );
  if (topicIds.length > 0) {
    const topicRows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<TopicRow>`SELECT * FROM topics
          WHERE id IN ${sql.in(topicIds)}`;
      }),
    );
    for (const topic of topicRows) {
      if (topic.archivedAt !== null) {
        continue;
      }
      await syncTopicRoomQuietly(deps, groupId, topic);
    }
  }
  if (deps.audit) {
    for (const topicId of topicIds) {
      await deps.audit.record({
        actorUserId: actorId,
        aiId: null,
        groupId,
        action: 'topic.role_removed',
        subjectId: topicId,
        argsHash: null,
        costCurrency: null,
        costAmount: null,
        result: 'ok',
        detail: { groupId, topicId, roleId },
      });
    }
    await deps.audit.record(auditEntry(groupId, 'group.role_deleted', actorId, roleId));
  }
}

// Every id must be a group member. Affected rooms re-sync, so a removed holder
// leaves a private topic reached only through this role.
export async function setRoleMembers(
  deps: TopicServiceDeps,
  groupId: string,
  roleId: string,
  actorId: string,
  userIds: string[],
): Promise<GroupRoleDetail> {
  await requireGroupManager(deps.db, groupId, actorId);
  const role = await requireRoleInGroup(deps.db, groupId, roleId);
  const wanted = [...new Set(userIds)];
  if (wanted.length > 0) {
    const rows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
          WHERE group_id = ${groupId} AND user_id IN ${sql.in(wanted)}`;
      }),
    );
    const known = new Set(rows.map((row) => row.userId));
    if (wanted.some((id) => !known.has(id))) {
      throw new HttpError(400, 'invalid_request', 'Role holders must be group members');
    }
  }
  // One transaction under the group lock, with the current set read inside it:
  // two concurrent PUTs serialize, so the result is last-writer-wins rather than
  // a merge of stale baselines.
  let added: string[] = [];
  let removed: string[] = [];
  try {
    const diff = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${groupId}))`;
            const rows = yield* sql<{ userId: string }>`SELECT user_id FROM group_member_roles
              WHERE role_id = ${role.id}`;
            const currentIds = new Set(rows.map((row) => row.userId));
            const wantedIds = new Set(wanted);
            const nextAdded = wanted.filter((id) => !currentIds.has(id));
            const nextRemoved = [...currentIds].filter((id) => !wantedIds.has(id));
            // Checked inside the transaction and before the insert, so a refusal
            // writes nothing.
            yield* assertRoleGrantAllowed(sql, role.id, actorId, nextAdded);
            if (nextAdded.length > 0) {
              yield* sql`INSERT INTO group_member_roles ${sql.insert(
                nextAdded.map((userId) => ({
                  role_id: role.id,
                  user_id: userId,
                  assigned_by: actorId,
                })),
              )} ON CONFLICT DO NOTHING`;
            }
            if (nextRemoved.length > 0) {
              yield* sql`DELETE FROM group_member_roles
                WHERE role_id = ${role.id} AND user_id IN ${sql.in(nextRemoved)}`;
            }
            return { added: nextAdded, removed: nextRemoved };
          }),
        );
      }),
    );
    added = diff.added;
    removed = diff.removed;
  } catch (error) {
    throw mapRoleError(error);
  }
  await syncTopicsWithRoles(deps, groupId, [role.id]);
  if (deps.audit) {
    for (const userId of added) {
      await deps.audit.record(
        auditEntry(groupId, 'group.role_assigned', actorId, role.id, { subjectUserId: userId }),
      );
    }
    for (const userId of removed) {
      await deps.audit.record(
        auditEntry(groupId, 'group.role_unassigned', actorId, role.id, { subjectUserId: userId }),
      );
    }
  }
  return toRoleDetail(deps.db, role);
}

// Runs after the membership row is gone and re-syncs the topics the user reached
// through a role. Scoped to this group's roles; never throws for no roles.
// Returns the removed ids for the caller's audit.
export async function dropMemberRoles(
  deps: TopicServiceDeps,
  groupId: string,
  userId: string,
): Promise<string[]> {
  const roles = await listGroupRoles(deps.db, groupId);
  if (roles.length === 0) {
    return [];
  }
  const ownIds = roles.map((role) => role.id);
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string }>`SELECT role_id FROM group_member_roles
        WHERE user_id = ${userId} AND role_id IN ${sql.in(ownIds)}`;
    }),
  );
  if (rows.length === 0) {
    return [];
  }
  const own = rows.map((row) => row.roleId);
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM group_member_roles
        WHERE user_id = ${userId} AND role_id IN ${sql.in(own)}`;
    }),
  );
  await syncTopicsWithRoles(deps, groupId, own);
  return own;
}

export async function toRoleDetail(
  db: ServerDatabase,
  role: GroupRoleRow,
): Promise<GroupRoleDetail> {
  return { id: role.id, name: role.name, members: await holdersOfRole(db, role) };
}

export async function listRoles(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<GroupRoleDetail[]> {
  await requireGroupMembership(db, groupId, actorId);
  const rows = await listGroupRoles(db, groupId);
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const details: GroupRoleDetail[] = [];
  for (const row of sorted) {
    details.push(await toRoleDetail(db, row));
  }
  return details;
}

// Every role each member holds; the caller filters to what it needs.
export async function roleHoldersByGroup(
  db: ServerDatabase,
  groupId: string,
): Promise<Map<string, GroupRoleView[]>> {
  const roles = await listGroupRoles(db, groupId);
  const byId = new Map(roles.map((role) => [role.id, { id: role.id, name: role.name }]));
  const result = new Map<string, GroupRoleView[]>();
  if (roles.length === 0) {
    return result;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string; userId: string }>`SELECT role_id, user_id
        FROM group_member_roles
        WHERE role_id IN ${sql.in(roles.map((role) => role.id))}`;
    }),
  );
  for (const row of rows) {
    const view = byId.get(row.roleId);
    if (!view) {
      continue;
    }
    const list = result.get(row.userId) ?? [];
    list.push(view);
    result.set(row.userId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  return result;
}

// The roles attached to one topic with holder counts, plus the approver role;
// only roles of the topic's group are returned.
export async function rolesOfTopic(
  db: ServerDatabase,
  topicId: string,
  groupId: string,
): Promise<{
  roles: Array<GroupRoleView & { memberCount: number }>;
  approverRole: GroupRoleView | null;
}> {
  const accessRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string }>`SELECT role_id FROM topic_role_access
        WHERE topic_id = ${topicId}`;
    }),
  );
  const roles = await listGroupRoles(db, groupId);
  const wanted = new Set(accessRows.map((row) => row.roleId));
  const attached = roles.filter((role) => wanted.has(role.id));
  attached.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  if (attached.length > 0) {
    const memberRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
          WHERE group_id = ${groupId}`;
      }),
    );
    const memberIds = new Set(memberRows.map((row) => row.userId));
    const holderRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ roleId: string; userId: string }>`SELECT role_id, user_id
          FROM group_member_roles
          WHERE role_id IN ${sql.in(attached.map((role) => role.id))}`;
      }),
    );
    for (const role of attached) {
      counts.set(
        role.id,
        holderRows.filter((row) => row.roleId === role.id && memberIds.has(row.userId)).length,
      );
    }
  }
  const [topic] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ approverRoleId: string | null }>`SELECT approver_role_id FROM topics
        WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  const approver = roles.find((role) => role.id === topic?.approverRoleId) ?? null;
  return {
    roles: attached.map((role) => ({
      id: role.id,
      name: role.name,
      memberCount: counts.get(role.id) ?? 0,
    })),
    approverRole: approver === null ? null : { id: approver.id, name: approver.name },
  };
}
