import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { TopicRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql, sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { syncTopicRoom } from '../topics/rooms';
import { requireGroupManager, requireRoleInGroup } from './access';
import { toRoleDetail } from './queries';
import {
  MAX_ROLES_PER_GROUP,
  toMissingRole,
  type GroupRoleDetail,
  type GroupRoleRow,
  type RolesServiceDeps,
} from './schemas';
import { syncTopicsWithRoles } from './sync';

export { GROUP_NOT_FOUND, MAX_ROLES_PER_GROUP, ROLE_NOT_FOUND } from './schemas';
export type { GroupRoleDetail, GroupRoleRow, GroupRoleView, RolesServiceDeps } from './schemas';
export { holdsTopicRole, topicRoleHolderIds } from './access';
export { listRoles, roleHoldersByGroup, rolesOfTopic, toRoleDetail } from './queries';

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
