import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupRoleRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { toMissingGroup, toMissingRole } from './schemas';

// The group row plus the actor's membership. A non-member sees the same 404
// as a missing group, so group ids cannot be probed.
export async function requireGroupMembership(
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

export async function requireGroupManager(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<void> {
  const membership = await requireGroupMembership(db, groupId, actorId);
  if (membership.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only group owners and admins can manage roles');
  }
}

export async function requireRoleInGroup(
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
export async function holdersOfRole(
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
