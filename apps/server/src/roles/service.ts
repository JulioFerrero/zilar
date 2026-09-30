import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import {
  groupMemberRoles,
  groupMembers,
  groupRoles,
  topicRoleAccess,
  topics,
  user,
} from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import type { InviteLogger } from '../groups/service';
import { syncTopicRoom } from '../topics/rooms';

export const MAX_ROLES_PER_GROUP = 20;
export const ROLE_NAME_MAX = 30;

const CONTROL_CHAR_MAX = 0x1f;
const CONTROL_CHAR_DEL = 0x7f;

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= CONTROL_CHAR_MAX || code === CONTROL_CHAR_DEL) {
      return true;
    }
  }
  return false;
}

export const roleNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'name must not be empty' })
  .max(ROLE_NAME_MAX, { message: `name must be at most ${ROLE_NAME_MAX} characters` })
  .refine((value) => !hasControlCharacters(value), {
    message: 'name must not contain control characters',
  });

export const createRoleBodySchema = z.object({ name: roleNameSchema }).strict();

export const renameRoleBodySchema = z.object({ name: roleNameSchema }).strict();

export const setRoleMembersBodySchema = z
  .object({ userIds: z.array(z.string().min(1)).max(50) })
  .strict();

export type GroupRoleRow = typeof groupRoles.$inferSelect;

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
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, actorId)))
    .limit(1);
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
  const [role] = await db
    .select()
    .from(groupRoles)
    .where(and(eq(groupRoles.id, roleId), eq(groupRoles.groupId, groupId)))
    .limit(1);
  if (!role) {
    throw toMissingRole();
  }
  return role;
}

// The holders of one role with their names, sorted by name. Shared by the
// list and the single-role reads so every shape agrees.
async function holdersOfRole(
  db: ServerDatabase,
  roleId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const rows = await db
    .select({ userId: groupMemberRoles.userId, name: user.name })
    .from(groupMemberRoles)
    .innerJoin(user, eq(user.id, groupMemberRoles.userId))
    .where(eq(groupMemberRoles.roleId, roleId));
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

export async function toRoleDetail(
  db: ServerDatabase,
  role: GroupRoleRow,
): Promise<GroupRoleDetail> {
  return { id: role.id, name: role.name, members: await holdersOfRole(db, role.id) };
}

export async function listRoles(
  db: ServerDatabase,
  groupId: string,
  actorId: string,
): Promise<GroupRoleDetail[]> {
  await requireGroupMembership(db, groupId, actorId);
  const rows = await db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId));
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const details: GroupRoleDetail[] = [];
  for (const row of rows) {
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
  const roles = await db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId));
  const byId = new Map(roles.map((role) => [role.id, { id: role.id, name: role.name }]));
  const result = new Map<string, GroupRoleView[]>();
  if (roles.length === 0) {
    return result;
  }
  const rows = await db
    .select({ roleId: groupMemberRoles.roleId, userId: groupMemberRoles.userId })
    .from(groupMemberRoles)
    .where(
      inArray(
        groupMemberRoles.roleId,
        roles.map((role) => role.id),
      ),
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

// The role ids `userId` holds in the group. Used by `canSeeTopic` and
// `canDecide` without loading names.
export async function roleIdsOfUser(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<Set<string>> {
  const roles = await db
    .select({ id: groupRoles.id })
    .from(groupRoles)
    .where(eq(groupRoles.groupId, groupId));
  if (roles.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ roleId: groupMemberRoles.roleId })
    .from(groupMemberRoles)
    .where(
      and(
        eq(groupMemberRoles.userId, userId),
        inArray(
          groupMemberRoles.roleId,
          roles.map((role) => role.id),
        ),
      ),
    );
  return new Set(rows.map((row) => row.roleId));
}

// The user ids holding any of `roleIds` that are still group members.
// Used to re-sync the affected topic rooms after an assignment change.
async function holderUserIds(
  db: ServerDatabase,
  groupId: string,
  roleIds: string[],
): Promise<Set<string>> {
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const memberIds = new Set(memberRows.map((row) => row.userId));
  const rows = await db
    .select({ userId: groupMemberRoles.userId })
    .from(groupMemberRoles)
    .where(inArray(groupMemberRoles.roleId, roleIds));
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
  const topicRows = await deps.db.select().from(topics).where(eq(topics.groupId, groupId));
  const accessRows = await deps.db
    .select({ topicId: topicRoleAccess.topicId, roleId: topicRoleAccess.roleId })
    .from(topicRoleAccess)
    .where(inArray(topicRoleAccess.roleId, roleIds));
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
  const existing = await deps.db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId));
  if (existing.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  if (existing.length >= MAX_ROLES_PER_GROUP) {
    throw new HttpError(400, 'invalid_request', `A group has at most ${MAX_ROLES_PER_GROUP} roles`);
  }
  const id = randomUUID();
  await deps.db.insert(groupRoles).values({ id, groupId, name, createdBy: actorId });
  const [role] = await deps.db.select().from(groupRoles).where(eq(groupRoles.id, id)).limit(1);
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
  const siblings = await deps.db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId));
  if (siblings.some((row) => row.id !== role.id && row.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'role_exists', 'A role with that name already exists');
  }
  await deps.db.update(groupRoles).set({ name }).where(eq(groupRoles.id, role.id));
  const [updated] = await deps.db.select().from(groupRoles).where(eq(groupRoles.id, role.id));
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
  const accessRows = await deps.db
    .select({ topicId: topicRoleAccess.topicId })
    .from(topicRoleAccess)
    .where(eq(topicRoleAccess.roleId, roleId));
  const topicIds = [...new Set(accessRows.map((row) => row.topicId))];
  await deps.db.delete(groupRoles).where(eq(groupRoles.id, roleId));
  if (topicIds.length > 0) {
    const topicRows = await deps.db.select().from(topics).where(inArray(topics.id, topicIds));
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
    const rows = await deps.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, wanted)));
    const known = new Set(rows.map((row) => row.userId));
    if (wanted.some((id) => !known.has(id))) {
      throw new HttpError(400, 'invalid_request', 'Role holders must be group members');
    }
  }
  const current = await deps.db
    .select({ userId: groupMemberRoles.userId })
    .from(groupMemberRoles)
    .where(eq(groupMemberRoles.roleId, role.id));
  const currentIds = new Set(current.map((row) => row.userId));
  const wantedIds = new Set(wanted);
  const added = wanted.filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !wantedIds.has(id));
  if (added.length > 0) {
    await deps.db
      .insert(groupMemberRoles)
      .values(added.map((userId) => ({ roleId: role.id, userId, assignedBy: actorId })))
      .onConflictDoNothing();
  }
  if (removed.length > 0) {
    await deps.db
      .delete(groupMemberRoles)
      .where(and(eq(groupMemberRoles.roleId, role.id), inArray(groupMemberRoles.userId, removed)));
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

// Drops every role row of a user who left (or was removed from) the group,
// then re-syncs the topics whose access they held through a role. Called
// from the remove/leave flow after the membership row is gone; never throws
// for a user with no roles.
export async function dropMemberRoles(
  deps: RolesServiceDeps,
  groupId: string,
  userId: string,
): Promise<void> {
  const rows = await deps.db
    .select({ roleId: groupMemberRoles.roleId })
    .from(groupMemberRoles)
    .where(eq(groupMemberRoles.userId, userId));
  if (rows.length === 0) {
    return;
  }
  const roles = await deps.db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId));
  const ownIds = new Set(roles.map((role) => role.id));
  const own = rows.map((row) => row.roleId).filter((id) => ownIds.has(id));
  await deps.db.delete(groupMemberRoles).where(eq(groupMemberRoles.userId, userId));
  await syncTopicsWithRoles(deps, groupId, own);
}

// The private member list of one topic: `topic_members` plus the holders of
// its roles who are still group members. Sorted by user id; callers join
// names. Public topics have no rows here.
export async function topicRoleHolderIds(
  db: ServerDatabase,
  topicId: string,
  groupId: string,
): Promise<Set<string>> {
  const accessRows = await db
    .select({ roleId: topicRoleAccess.roleId })
    .from(topicRoleAccess)
    .where(eq(topicRoleAccess.topicId, topicId));
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
  const accessRows = await db
    .select({ roleId: topicRoleAccess.roleId })
    .from(topicRoleAccess)
    .where(eq(topicRoleAccess.topicId, topicId));
  if (accessRows.length === 0) {
    return false;
  }
  const [row] = await db
    .select({ userId: groupMemberRoles.userId })
    .from(groupMemberRoles)
    .where(
      and(
        eq(groupMemberRoles.userId, userId),
        inArray(
          groupMemberRoles.roleId,
          accessRows.map((access) => access.roleId),
        ),
      ),
    )
    .limit(1);
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
  const accessRows = await db
    .select({ roleId: topicRoleAccess.roleId })
    .from(topicRoleAccess)
    .where(eq(topicRoleAccess.topicId, topicId));
  const roles = await db.select().from(groupRoles).where(eq(groupRoles.groupId, groupId));
  const wanted = new Set(accessRows.map((row) => row.roleId));
  const attached = roles.filter((role) => wanted.has(role.id));
  attached.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  if (attached.length > 0) {
    const memberRows = await db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    const memberIds = new Set(memberRows.map((row) => row.userId));
    const holderRows = await db
      .select({ roleId: groupMemberRoles.roleId, userId: groupMemberRoles.userId })
      .from(groupMemberRoles)
      .where(
        inArray(
          groupMemberRoles.roleId,
          attached.map((role) => role.id),
        ),
      );
    for (const role of attached) {
      counts.set(
        role.id,
        holderRows.filter((row) => row.roleId === role.id && memberIds.has(row.userId)).length,
      );
    }
  }
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
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
