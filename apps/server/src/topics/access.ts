import { and, count, eq, inArray } from 'drizzle-orm';
import { Schema } from 'effect';
import type { ServerDatabase } from '../db/client';
import {
  ais,
  groupMemberRoles,
  groupMembers,
  topicAis,
  topicMembers,
  topicRoleAccess,
  topics,
  user,
} from '../db/schema';
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

export type TopicRow = typeof topics.$inferSelect;

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

export async function getTopic(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  return row ?? null;
}

export async function getGroupMembership(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' } | null> {
  const [row] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function isPrivateMember(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: topicMembers.userId })
    .from(topicMembers)
    .where(and(eq(topicMembers.topicId, topicId), eq(topicMembers.userId, userId)))
    .limit(1);
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
  const rows = await db.select().from(topics).where(eq(topics.groupId, groupId));
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
    const memberRows = await db
      .select({ topicId: topicMembers.topicId })
      .from(topicMembers)
      .where(and(inArray(topicMembers.topicId, privateIds), eq(topicMembers.userId, userId)));
    privateSeen = new Set(memberRows.map((row) => row.topicId));
    // T-0116: topics reached through a role, not a direct row.
    const roleRows = await db
      .select({ topicId: topicRoleAccess.topicId })
      .from(topicRoleAccess)
      .innerJoin(groupMemberRoles, eq(groupMemberRoles.roleId, topicRoleAccess.roleId))
      .where(
        and(inArray(topicRoleAccess.topicId, privateIds), eq(groupMemberRoles.userId, userId)),
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
    const [row] = await db
      .select({ total: count() })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, topic.groupId));
    return Number(row?.total ?? 0);
  }
  // T-0116: `topic_members` plus the holders of its roles (still group
  // members). A holder who is also a direct member counts once.
  const [direct, holders] = await Promise.all([
    db
      .select({ userId: topicMembers.userId })
      .from(topicMembers)
      .where(eq(topicMembers.topicId, topic.id)),
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
    const [row] = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.id, topic.ownerUserId))
      .limit(1);
    if (!row) {
      return null;
    }
    return { kind: 'user', id: row.id, name: row.name };
  }
  if (topic.ownerAiId !== null) {
    const [row] = await db
      .select({ id: ais.id, name: ais.name })
      .from(ais)
      .where(eq(ais.id, topic.ownerAiId))
      .limit(1);
    if (!row) {
      return null;
    }
    return { kind: 'ai', id: row.id, name: row.name };
  }
  return null;
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
  const [row] = await db
    .select({ aiId: topicAis.aiId })
    .from(topicAis)
    .where(and(eq(topicAis.topicId, topic.id), eq(topicAis.aiId, ai.id)))
    .limit(1);
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
  const rows = await db
    .select({ aiId: topicAis.aiId, owner: ais.owner, status: ais.status })
    .from(topicAis)
    .innerJoin(ais, eq(ais.id, topicAis.aiId))
    .where(eq(topicAis.topicId, topic.id));
  const active = rows.filter((row) => row.status === 'active');
  if (topic.visibility !== 'private') {
    return new Set(active.map((row) => row.aiId));
  }
  const memberRows = await db
    .select({ userId: topicMembers.userId })
    .from(topicMembers)
    .where(eq(topicMembers.topicId, topic.id));
  const memberIds = new Set(memberRows.map((row) => row.userId));
  // T-0116: an owner who reaches the private topic only through a role
  // keeps their AI in the room, like the room sync does.
  for (const holder of await topicRoleHolderIds(db, topic.id, topic.groupId)) {
    memberIds.add(holder);
  }
  const groupRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, topic.groupId));
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
  const rows = await db
    .select({ id: ais.id, name: ais.name })
    .from(topicAis)
    .innerJoin(ais, eq(ais.id, topicAis.aiId))
    .where(eq(topicAis.topicId, topicId));
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function toTopicViews(
  db: ServerDatabase,
  rows: TopicRow[],
  mucDomain: string,
): Promise<TopicView[]> {
  const views: TopicView[] = [];
  for (const row of rows) {
    views.push(await toTopicView(db, row, mucDomain));
  }
  views.sort((a, b) => {
    if (a.isGeneral !== b.isGeneral) {
      return a.isGeneral ? -1 : 1;
    }
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return views;
}
