import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupRoleRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { holdersOfRole, requireGroupMembership } from './access';
import type { GroupRoleDetail, GroupRoleView } from './schemas';

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
