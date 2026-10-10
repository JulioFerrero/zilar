import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { GroupRoleRow, TopicRow } from '../db/rows';
import { runSql, sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { InviteLogger } from '../groups/service';
import { syncTopicRoom } from '../topics/rooms';

export const MAX_ROLES_PER_GROUP = 20;

export type { GroupRoleRow };

export interface GroupRoleView {
  id: string;
  name: string;
}

export interface GroupRoleDetail extends GroupRoleView {
  /** The holders, sorted by name. Role membership is not secret. */
  members: Array<{ userId: string; name: string }>;
}

export interface RolesServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

export const GROUP_NOT_FOUND = {
  status: 404 as const,
  code: 'not_found',
  message: 'Group not found',
};

export const ROLE_NOT_FOUND = {
  status: 404 as const,
  code: 'not_found',
  message: 'Role not found',
};

function toMissingGroup(): HttpError {
  return new HttpError(GROUP_NOT_FOUND.status, GROUP_NOT_FOUND.code, GROUP_NOT_FOUND.message);
}

function toMissingRole(): HttpError {
  return new HttpError(ROLE_NOT_FOUND.status, ROLE_NOT_FOUND.code, ROLE_NOT_FOUND.message);
}

// The group row plus the actor's membership. A non-member sees the same 404
// as a missing group, so group ids cannot be probed.
async function requireGroupMembership(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' }> {
  const [membership] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' }>`
        SELECT group_id, user_id, role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${actorId} LIMIT 1`;
    }),
  );
  if (!membership) {
    throw toMissingGroup();
  }
  return membership;
}

async function requireGroupManager(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<void> {
  const membership = await requireGroupMembership(db, groupId, actorId);
  if (membership.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only group owners and admins can manage roles');
  }
}

async function requireRoleInGroup(
  db: ServerDatabase,
  groupId: string,
  roleId: string,
): Promise<GroupRoleRow> {
  const [role] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles
        WHERE id = ${roleId} AND group_id = ${groupId} LIMIT 1`;
    }),
  );
  if (!role) {
    throw toMissingRole();
  }
  return role;
}

// The holders of one role with their names, sorted by name. Joined to the
// group's membership, so a departed user is never listed even if their row
// somehow survived the leave cleanup. Shared by the list and the
// single-role reads so every shape agrees.
async function holdersOfRole(
  db: ServerDatabase,
  role: GroupRoleRow,
): Promise<Array<{ userId: string; name: string }>> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string; name: string }>`
        SELECT gmr.user_id, u.name FROM group_member_roles gmr
        INNER JOIN "user" u ON u.id = gmr.user_id
        INNER JOIN group_members gm
          ON gm.group_id = ${role.groupId} AND gm.user_id = gmr.user_id
        WHERE gmr.role_id = ${role.id}`;
    }),
  );
  return [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
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
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const details: GroupRoleDetail[] = [];
  for (const row of sorted) {
    details.push(await toRoleDetail(db, row));
  }
  return details;
}

// Every role of the group each member holds, for the `GET members` shape.
// Returns one entry per group member (sorted with the group list); the
// caller filters to what it needs.
export async function roleHoldersByGroup(
  db: ServerDatabase,
  groupId: string,
): Promise<Map<string, GroupRoleView[]>> {
  const roles = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
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

// The user ids holding any of `roleIds` that are still group members.
// Used to re-sync the affected topic rooms after an assignment change.
async function holderUserIds(
  db: ServerDatabase,
  groupId: string,
  roleIds: string[],
): Promise<Set<string>> {
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${groupId}`;
    }),
  );
  const memberIds = new Set(memberRows.map((row) => row.userId));
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_member_roles
        WHERE role_id IN ${sql.in(roleIds)}`;
    }),
  );
  return new Set(rows.map((row) => row.userId).filter((id) => memberIds.has(id)));
}

// Re-syncs every non-archived topic room of the group that grants access to
// any of `roleIds`. Best effort per room (logged with the group id, never a
// topic name): the database is the source of truth.
async function syncTopicsWithRoles(
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

function mapRoleError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  // A concurrent create/rename that clashed on the case-insensitive name
  // lands here (the pre-check passed, the unique index refused): answer 409
  // like the pre-check does, not 503.
  if (isUniqueViolation(error)) {
    return new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    return error.reason._tag === 'UniqueViolation';
  }
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
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
    // Ids only: a group-role action never carries names, so a private
    // topic's name cannot leak through the log.
    detail: { groupId, ...extra },
  };
}

export async function createRole(
  deps: RolesServiceDeps,
  groupId: string,
  actorId: string,
  name: string,
): Promise<GroupRoleDetail> {
  await requireGroupManager(deps.db, groupId, actorId);
  // The duplicate check stays outside (the unique index + 409 mapping below
  // keep it race-safe), but the count check and the insert run in one
  // transaction under a per-group advisory lock: two concurrent creates
  // past the cap would otherwise both read under 20 and both insert.
  const existing = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
  if (existing.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  const id = randomUUID();
  try {
    await sqlRuntimeFor(deps.db).runPromise(
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
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(auditEntry(groupId, 'group.role_created', actorId, role.id));
  }
  return toRoleDetail(deps.db, role);
}

export async function renameRole(
  deps: RolesServiceDeps,
  groupId: string,
  roleId: string,
  actorId: string,
  name: string,
): Promise<GroupRoleDetail> {
  await requireGroupManager(deps.db, groupId, actorId);
  const role = await requireRoleInGroup(deps.db, groupId, roleId);
  const siblings = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
  if (siblings.some((row) => row.id !== role.id && row.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  // The unique index owns the race: a concurrent rename to the same name
  // lands in `mapRoleError` as a 409, like the pre-check.
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

// Deletes the role everywhere (assignments, topic access, approver columns
// fall back to null by `ON DELETE SET NULL`) and re-syncs the topics that
// granted it access.
export async function deleteRole(
  deps: RolesServiceDeps,
  groupId: string,
  roleId: string,
  actorId: string,
): Promise<void> {
  await requireGroupManager(deps.db, groupId, actorId);
  await requireRoleInGroup(deps.db, groupId, roleId);
  // Capture the affected topics before the cascade removes the rows: after
  // the delete there is nothing left to query.
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
        // Ids only, like every other role audit row.
        detail: { groupId, topicId, roleId },
      });
    }
    await deps.audit.record(auditEntry(groupId, 'group.role_deleted', actorId, roleId));
  }
}

// Replaces the role's assignment set. Every id must be a group member; the
// affected topic rooms re-sync so new holders join and removed holders leave
// a private topic they reach only through this role.
export async function setRoleMembers(
  deps: RolesServiceDeps,
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
  // The whole replace-the-set runs in one transaction under the group's
  // advisory lock, and the current set is read INSIDE it: two concurrent
  // PUTs serialize, and the second diffs against the first's commit, so
  // the result is last-writer-wins instead of a merge of stale baselines.
  // The room re-sync and the audit rows below use that same read.
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

// Drops the member's role rows of this group when they leave (or are
// removed), then re-syncs the topics whose access they held through a role.
// Called from the remove/leave flow after the membership row is gone; never
// throws for a user with no roles. Scoped to this group's roles: rows held
// in other groups survive untouched. Returns the removed role ids so the
// caller can audit the loss.
export async function dropMemberRoles(
  deps: RolesServiceDeps,
  groupId: string,
  userId: string,
): Promise<string[]> {
  const roles = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
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

// The private member list of one topic: `topic_members` plus the holders of
// its roles who are still group members. Sorted by user id; callers join
// names. Public topics have no rows here.
export async function topicRoleHolderIds(
  db: ServerDatabase,
  topicId: string,
  groupId: string,
): Promise<Set<string>> {
  const accessRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string }>`SELECT role_id FROM topic_role_access
        WHERE topic_id = ${topicId}`;
    }),
  );
  if (accessRows.length === 0) {
    return new Set();
  }
  return holderUserIds(
    db,
    groupId,
    accessRows.map((row) => row.roleId),
  );
}

// Whether the user holds any role listed in `topic_role_access` for the
// topic. Group membership is checked by the caller.
export async function holdsTopicRole(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<boolean> {
  const accessRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ roleId: string }>`SELECT role_id FROM topic_role_access
        WHERE topic_id = ${topicId}`;
    }),
  );
  if (accessRows.length === 0) {
    return false;
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_member_roles
        WHERE user_id = ${userId}
          AND role_id IN ${sql.in(accessRows.map((access) => access.roleId))} LIMIT 1`;
    }),
  );
  return row !== undefined;
}

// The roles attached to one topic with their holder counts, plus the
// approver role. Sorted by name. Only roles of the topic's group are ever
// returned.
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
  const roles = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoleRow>`SELECT * FROM group_roles WHERE group_id = ${groupId}`;
    }),
  );
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
