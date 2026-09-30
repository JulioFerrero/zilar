import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import {
  ais,
  groupAis,
  groupMembers,
  groupRoles,
  groups,
  topicAis,
  topicMembers,
  topicRoleAccess,
  topics,
  user,
} from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { randomRoomLocalpart, type InviteLogger } from '../groups/service';
import { topicRoleHolderIds } from '../roles/service';
import {
  aiMayBeInTopic,
  canCreateTopic,
  canManageTopic,
  canSeeTopic,
  getGroupMembership,
  getTopic,
  requireManagedTopic,
  requireVisibleTopic,
  toMissingTopic,
  topicKindSchema,
  topicStatusSchema,
  topicVisibilitySchema,
  type TopicRow,
} from './access';
import { emitTopicAi } from '../groups/events';
import { revokeActiveRulesForAiInTopic } from '../approvals/rules';
import { deleteRoutinesForAiInTopic } from '../routines/service';
import { deleteToolsForAiInTopic } from '../tools/service';
import { syncTopicRoom } from './rooms';

export const TOPIC_NAME_MAX = 80;
export const TOPIC_LINK_URL_MAX = 300;
export const TOPIC_LINK_LABEL_MAX = 40;

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

const nameSchema = z
  .string()
  .trim()
  .min(1, { message: 'name must not be empty' })
  .max(TOPIC_NAME_MAX, { message: `name must be at most ${TOPIC_NAME_MAX} characters` })
  .refine((value) => !hasControlCharacters(value), {
    message: 'name must not contain control characters',
  });

const glyphSchema = z
  .string()
  .min(1, { message: 'glyph must not be empty' })
  .max(8, { message: 'glyph must be at most 2 characters' })
  .refine((value) => [...value].length >= 1 && [...value].length <= 2, {
    message: 'glyph must be 1 or 2 characters',
  })
  .refine((value) => !hasControlCharacters(value), {
    message: 'glyph must not contain control characters',
  });

const linkUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(TOPIC_LINK_URL_MAX)
  .refine((value) => value.startsWith('https://'), {
    message: 'linkUrl must be an https URL',
  })
  .refine(
    (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'linkUrl must be a valid URL' },
  );

const linkLabelSchema = z
  .string()
  .trim()
  .min(1, { message: 'linkLabel must not be empty' })
  .max(TOPIC_LINK_LABEL_MAX, {
    message: `linkLabel must be at most ${TOPIC_LINK_LABEL_MAX} characters`,
  });

const ownerSchema = z
  .object({
    kind: z.enum(['user', 'ai']),
    id: z.string().min(1),
  })
  .strict();

export const createTopicBodySchema = z
  .object({
    name: nameSchema,
    kind: topicKindSchema.optional(),
    visibility: topicVisibilitySchema.optional(),
    memberIds: z.array(z.string().min(1)).max(50).optional(),
    glyph: glyphSchema.optional(),
    owner: ownerSchema.nullable().optional(),
    linkUrl: linkUrlSchema.nullish(),
    linkLabel: linkLabelSchema.nullish(),
  })
  .strict();

export const patchTopicBodySchema = z
  .object({
    name: nameSchema.optional(),
    glyph: glyphSchema.optional(),
    kind: topicKindSchema.optional(),
    status: topicStatusSchema.optional(),
    owner: ownerSchema.nullish(),
    linkUrl: linkUrlSchema.nullish(),
    linkLabel: linkLabelSchema.nullish(),
    archived: z.literal(true).optional(),
    visibility: topicVisibilitySchema.optional(),
    memberIds: z.array(z.string().min(1)).max(50).optional(),
    confirmExposeHistory: z.boolean().optional(),
  })
  .strict();

export type CreateTopicBody = z.infer<typeof createTopicBodySchema>;
export type PatchTopicBody = z.infer<typeof patchTopicBodySchema>;

export interface TopicServiceDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

export interface CreateTopicInput extends CreateTopicBody {
  groupId: string;
  actorId: string;
}

export function defaultGlyph(name: string): string {
  const first = [...name.trim()][0] ?? 'G';
  return first.toUpperCase();
}

async function uniqueRoomLocalpart(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
): Promise<{ localpart: string; roomCreated: boolean }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const localpart = randomRoomLocalpart();
    const [existing] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.roomLocalpart, localpart))
      .limit(1);
    if (existing) {
      continue;
    }
    const created = await adminClient.createRoom(localpart, {
      membersOnly: true,
      persistent: true,
      mam: true,
      anonymous: false,
    });
    return { localpart, roomCreated: created.created };
  }
  throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

// Audit detail for topic actions never contains the topic name for a private
// topic: ids and counts only.
export function auditDetail(topic: TopicRow, extra: Record<string, unknown> = {}) {
  if (topic.visibility === 'private') {
    return { topicId: topic.id, groupId: topic.groupId, ...extra };
  }
  return { topicId: topic.id, groupId: topic.groupId, name: topic.name, ...extra };
}

function toAuditEntry(
  topic: TopicRow,
  action: string,
  actorUserId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    actorUserId,
    aiId: null as string | null,
    groupId: topic.groupId,
    action,
    subjectId: topic.id,
    argsHash: null as string | null,
    costCurrency: null as 'EUR' | 'USD' | null,
    costAmount: null as number | null,
    result: 'ok' as const,
    detail: auditDetail(topic, extra),
  };
}

async function assertNameFree(
  db: ServerDatabase,
  groupId: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const rows = await db.select().from(topics).where(eq(topics.groupId, groupId));
  const clash = rows.some(
    (row) =>
      row.archivedAt === null &&
      row.name.toLowerCase() === name.toLowerCase() &&
      row.id !== exceptId,
  );
  if (clash) {
    throw new HttpError(409, 'topic_exists', 'A topic with that name already exists');
  }
}

async function assertOwner(
  db: ServerDatabase,
  groupId: string,
  owner: { kind: 'user' | 'ai'; id: string } | null | undefined,
): Promise<{ ownerUserId: string | null; ownerAiId: string | null }> {
  if (owner === undefined || owner === null) {
    return { ownerUserId: null, ownerAiId: null };
  }
  if (owner.kind === 'user') {
    const membership = await getGroupMembership(db, groupId, owner.id);
    if (!membership) {
      throw new HttpError(400, 'invalid_request', 'The topic owner must be a group member');
    }
    return { ownerUserId: owner.id, ownerAiId: null };
  }
  const [ai] = await db.select({ id: ais.id }).from(ais).where(eq(ais.id, owner.id)).limit(1);
  if (!ai) {
    throw new HttpError(400, 'invalid_request', 'The topic owner AI was not found');
  }
  return { ownerUserId: null, ownerAiId: owner.id };
}

async function assertLink(
  linkUrl: string | null | undefined,
  linkLabel: string | null | undefined,
): Promise<void> {
  const hasUrl = linkUrl !== undefined && linkUrl !== null;
  const hasLabel = linkLabel !== undefined && linkLabel !== null;
  if (!hasUrl && !hasLabel) {
    return;
  }
  if (hasUrl !== hasLabel) {
    throw new HttpError(400, 'invalid_request', 'linkUrl and linkLabel must be set together');
  }
}

async function assertMembersAreGroupMembers(
  db: ServerDatabase,
  groupId: string,
  memberIds: string[],
): Promise<void> {
  if (memberIds.length === 0) {
    return;
  }
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.userId, memberIds)));
  const known = new Set(rows.map((row) => row.userId));
  if (memberIds.some((id) => !known.has(id))) {
    throw new HttpError(400, 'invalid_request', 'Topic members must be group members');
  }
}

export async function createTopic(
  deps: TopicServiceDeps,
  input: CreateTopicInput,
): Promise<TopicRow> {
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
  const membership = group ? await getGroupMembership(deps.db, input.groupId, input.actorId) : null;
  // A stranger sees the same 404 as a missing group.
  if (!group || !membership) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  if (
    !(await canCreateTopic(deps.db, input.groupId, input.actorId, group.membersCanCreateTopics))
  ) {
    throw new HttpError(403, 'forbidden', 'Only group owners and admins can create topics');
  }

  const visibility = input.visibility ?? 'public';
  const memberIds = [...new Set(input.memberIds ?? [])];
  if (visibility !== 'private' && memberIds.length > 0) {
    throw new HttpError(400, 'invalid_request', 'memberIds is only for private topics');
  }
  if (visibility === 'private' && !memberIds.includes(input.actorId)) {
    memberIds.push(input.actorId);
  }
  await assertMembersAreGroupMembers(deps.db, input.groupId, memberIds);
  await assertNameFree(deps.db, input.groupId, input.name);
  const { ownerUserId, ownerAiId } = await assertOwner(deps.db, input.groupId, input.owner);
  await assertLink(input.linkUrl, input.linkLabel);

  const topicId = randomUUID();
  let roomLocalpart = '';
  let roomCreated = false;
  try {
    const room = await uniqueRoomLocalpart(deps.db, deps.adminClient);
    roomLocalpart = room.localpart;
    roomCreated = room.roomCreated;
    await deps.db.insert(topics).values({
      id: topicId,
      groupId: input.groupId,
      name: input.name,
      glyph: input.glyph ?? defaultGlyph(input.name),
      roomLocalpart,
      visibility,
      kind: input.kind ?? 'chat',
      status: 'open',
      ownerUserId,
      ownerAiId,
      linkUrl: input.linkUrl ?? null,
      linkLabel: input.linkLabel ?? null,
      isGeneral: false,
      createdBy: input.actorId,
    });
    if (visibility === 'private') {
      await deps.db
        .insert(topicMembers)
        .values(memberIds.map((userId) => ({ topicId, userId, addedBy: input.actorId })));
    }
  } catch (error) {
    if (roomCreated || roomLocalpart !== '') {
      await destroyQuietly(deps.adminClient, roomLocalpart);
    }
    // Roll the row back when the insert raced another writer (name or
    // localpart clashed after the check): the room is gone either way.
    await deps.db.delete(topicMembers).where(eq(topicMembers.topicId, topicId));
    await deps.db.delete(topics).where(eq(topics.id, topicId));
    throw mapXmppError(error);
  }

  const [topic] = await deps.db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  if (!topic) {
    if (roomLocalpart !== '') {
      await destroyQuietly(deps.adminClient, roomLocalpart);
    }
    throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  try {
    await syncTopicRoom(deps, topic);
  } catch (error) {
    await destroyQuietly(deps.adminClient, roomLocalpart);
    await deps.db.delete(topicMembers).where(eq(topicMembers.topicId, topicId));
    await deps.db.delete(topics).where(eq(topics.id, topicId));
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(topic, 'topic.created', input.actorId));
  }
  return topic;
}

export interface PatchTopicInput extends PatchTopicBody {
  topicId: string;
  actorId: string;
}

export async function patchTopic(
  deps: TopicServiceDeps,
  input: PatchTopicInput,
): Promise<TopicRow> {
  const topic = await requireVisibleTopic(deps.db, input.topicId, input.actorId);
  const isManager = await canManageTopic(deps.db, topic, input.actorId);
  // Editing the task strip (status, owner, link, kind) is open to anyone who
  // can see the topic; name/glyph/visibility/archive/memberIds need a manager.
  const stripOnly =
    input.name === undefined &&
    input.glyph === undefined &&
    input.visibility === undefined &&
    input.archived === undefined &&
    input.memberIds === undefined;

  if (!stripOnly && !isManager) {
    if (topic.archivedAt !== null) {
      throw toMissingTopic();
    }
    throw new HttpError(
      403,
      'forbidden',
      'Only the topic creator or a group owner or admin can change it',
    );
  }
  if (topic.archivedAt !== null) {
    throw toMissingTopic();
  }

  if (topic.isGeneral) {
    if (input.visibility !== undefined && input.visibility !== 'public') {
      throw new HttpError(400, 'invalid_request', 'The General topic cannot be made private');
    }
    if (input.archived === true) {
      throw new HttpError(400, 'invalid_request', 'The General topic cannot be archived');
    }
    if (input.memberIds !== undefined) {
      throw new HttpError(400, 'not_private', 'The General topic is public');
    }
  }

  const nextVisibility = input.visibility ?? topic.visibility;
  const exposingHistory = topic.visibility === 'private' && nextVisibility === 'public';
  if (exposingHistory && input.confirmExposeHistory !== true) {
    throw new HttpError(
      400,
      'confirmation_required',
      'Making a private topic public exposes its history to the whole group',
    );
  }
  if (topic.visibility === 'public' && nextVisibility === 'private') {
    const memberIds = [...new Set(input.memberIds ?? [])];
    if (!memberIds.includes(input.actorId)) {
      memberIds.push(input.actorId);
    }
    await assertMembersAreGroupMembers(deps.db, topic.groupId, memberIds);
    if (input.memberIds === undefined) {
      throw new HttpError(
        400,
        'invalid_request',
        'Making a topic private needs memberIds including yourself',
      );
    }
  }

  if (input.name !== undefined) {
    await assertNameFree(deps.db, topic.groupId, input.name, topic.id);
  }
  const { ownerUserId, ownerAiId } =
    input.owner === undefined
      ? { ownerUserId: undefined, ownerAiId: undefined }
      : await assertOwner(deps.db, topic.groupId, input.owner);
  const nextLinkUrl = input.linkUrl === undefined ? topic.linkUrl : (input.linkUrl ?? null);
  const nextLinkLabel = input.linkLabel === undefined ? topic.linkLabel : (input.linkLabel ?? null);
  if (input.linkUrl !== undefined || input.linkLabel !== undefined) {
    await assertLink(nextLinkUrl, nextLinkLabel);
  }

  const patch: Partial<TopicRow> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.glyph !== undefined) patch.glyph = input.glyph;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.status !== undefined) patch.status = input.status;
  if (input.owner !== undefined) {
    patch.ownerUserId = ownerUserId ?? null;
    patch.ownerAiId = ownerAiId ?? null;
  }
  if (input.linkUrl !== undefined) patch.linkUrl = input.linkUrl ?? null;
  if (input.linkLabel !== undefined) patch.linkLabel = input.linkLabel ?? null;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.archived === true) patch.archivedAt = new Date();

  const visibilityChanged = topic.visibility !== nextVisibility;
  const goingPrivate = topic.visibility === 'public' && nextVisibility === 'private';
  const goingPublic = topic.visibility === 'private' && nextVisibility === 'public';

  await deps.db.update(topics).set(patch).where(eq(topics.id, topic.id));
  if (goingPrivate) {
    const memberIds = [...new Set(input.memberIds ?? [])];
    if (!memberIds.includes(input.actorId)) {
      memberIds.push(input.actorId);
    }
    await deps.db
      .insert(topicMembers)
      .values(memberIds.map((userId) => ({ topicId: topic.id, userId, addedBy: input.actorId })))
      .onConflictDoNothing();
  }
  if (goingPublic) {
    await deps.db.delete(topicMembers).where(eq(topicMembers.topicId, topic.id));
  }

  const [updated] = await deps.db.select().from(topics).where(eq(topics.id, topic.id)).limit(1);
  if (!updated) {
    throw toMissingTopic();
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  // A public-to-private change may leave AIs whose owner is not in
  // `memberIds`: they drop out of the room here (rows stay). Live sessions
  // leave on the event, like after a member removal.
  if (goingPrivate) {
    await emitDroppedTopicAis(deps, updated);
  }

  if (deps.audit) {
    const action =
      input.archived === true
        ? 'topic.archived'
        : visibilityChanged
          ? 'topic.visibility_changed'
          : 'topic.updated';
    await deps.audit.record(toAuditEntry(updated, action, input.actorId));
  }
  return updated;
}

export async function archiveTopic(
  deps: TopicServiceDeps,
  topicId: string,
  actorId: string,
): Promise<TopicRow> {
  return patchTopic(deps, { topicId, actorId, archived: true });
}

export async function listTopicMembers(
  deps: Pick<TopicServiceDeps, 'db'>,
  topicId: string,
  userId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const topic = await requireVisibleTopic(deps.db, topicId, userId);
  if (topic.visibility !== 'private') {
    const rows = await deps.db
      .select({ userId: groupMembers.userId, name: user.name })
      .from(groupMembers)
      .innerJoin(user, eq(user.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, topic.groupId));
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  }
  // T-0116: direct members plus the holders of the topic's roles (still
  // group members). Everyone holding the topic can see the full list: role
  // membership is not secret.
  const [direct, holders] = await Promise.all([
    deps.db
      .select({ userId: topicMembers.userId })
      .from(topicMembers)
      .where(eq(topicMembers.topicId, topic.id)),
    topicRoleHolderIds(deps.db, topic.id, topic.groupId),
  ]);
  const ids = new Set(direct.map((row) => row.userId));
  for (const id of holders) {
    ids.add(id);
  }
  if (ids.size === 0) {
    return [];
  }
  const rows = await deps.db
    .select({ userId: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...ids]));
  // `topic_members` rows for users who left the group no longer count (the
  // room sync drops them too); the join above only returns live users.
  const memberRows = await deps.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, topic.groupId));
  const memberIds = new Set(memberRows.map((row) => row.userId));
  return rows
    .filter((row) => memberIds.has(row.userId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

export async function addTopicMember(
  deps: TopicServiceDeps,
  topicId: string,
  actorId: string,
  targetUserId: string,
): Promise<TopicRow> {
  const topic = await requireManagedTopic(deps.db, topicId, actorId);
  if (topic.visibility !== 'private') {
    throw new HttpError(400, 'not_private', 'Only private topics have members');
  }
  const membership = await getGroupMembership(deps.db, topic.groupId, targetUserId);
  if (!membership) {
    throw new HttpError(400, 'invalid_request', 'Topic members must be group members');
  }
  await deps.db
    .insert(topicMembers)
    .values({ topicId: topic.id, userId: targetUserId, addedBy: actorId })
    .onConflictDoNothing();
  const [updated] = await deps.db.select().from(topics).where(eq(topics.id, topic.id)).limit(1);
  if (!updated) {
    throw toMissingTopic();
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(
      toAuditEntry(updated, 'topic.member_added', actorId, { subjectUserId: targetUserId }),
    );
  }
  return updated;
}

export async function removeTopicMember(
  deps: TopicServiceDeps,
  topicId: string,
  actorId: string,
  targetUserId: string,
): Promise<TopicRow> {
  const topic = await getTopic(deps.db, topicId);
  if (!topic || topic.archivedAt !== null) {
    throw toMissingTopic();
  }
  if (!(await canSeeTopic(deps.db, topic, actorId))) {
    throw toMissingTopic();
  }
  if (topic.visibility !== 'private') {
    throw new HttpError(400, 'not_private', 'Only private topics have members');
  }
  const [existing] = await deps.db
    .select({ userId: topicMembers.userId })
    .from(topicMembers)
    .where(and(eq(topicMembers.topicId, topic.id), eq(topicMembers.userId, targetUserId)))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, 'not_found', 'That user is not a member of this topic');
  }
  const isSelf = actorId === targetUserId;
  if (!isSelf && !(await canManageTopic(deps.db, topic, actorId))) {
    throw new HttpError(
      403,
      'forbidden',
      'Only a manager or the member themselves can remove a member',
    );
  }
  await deps.db
    .delete(topicMembers)
    .where(and(eq(topicMembers.topicId, topic.id), eq(topicMembers.userId, targetUserId)));

  const remaining = await deps.db
    .select({ userId: topicMembers.userId })
    .from(topicMembers)
    .where(eq(topicMembers.topicId, topic.id));
  // T-0116: the topic drains only when the direct rows AND the role holders
  // are gone — a holder the role still grants access to keeps it alive.
  const holders =
    remaining.length === 0
      ? await topicRoleHolderIds(deps.db, topic.id, topic.groupId)
      : new Set<string>();
  let updated = (await getTopic(deps.db, topic.id)) ?? topic;
  if (remaining.length === 0 && holders.size === 0) {
    await deps.db
      .update(topics)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(topics.id, topic.id));
    updated = (await getTopic(deps.db, topic.id)) ?? topic;
    // The room still holds the just-removed members: desired members is now
    // empty, so the sync below removes everyone from the room.
    try {
      await syncTopicRoom(deps, updated);
    } catch (error) {
      throw error instanceof HttpError
        ? error
        : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
    }
    if (deps.audit) {
      await deps.audit.record(toAuditEntry(updated, 'topic.archived', actorId));
    }
    return updated;
  }
  updated = (await getTopic(deps.db, topic.id)) ?? topic;
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  // The removed user may own AIs in this topic: any AI whose owner can no
  // longer see it drops out of the room (rows stay, so re-adding the owner
  // brings them back). Live gateway sessions leave on the event below.
  await emitDroppedTopicAis(deps, updated);
  if (deps.audit) {
    await deps.audit.record(
      toAuditEntry(updated, 'topic.member_removed', actorId, { subjectUserId: targetUserId }),
    );
  }
  return updated;
}

// Compares the topic's `topic_ais` rows against the live rule
// (`aiMayBeInTopic`) and emits `ai-removed` for every AI that just dropped
// out of the room. The sync above already removed their affiliations; this
// tells live gateway sessions to leave right away instead of waiting for
// the next reconcile.
async function emitDroppedTopicAis(deps: TopicServiceDeps, topic: TopicRow): Promise<void> {
  if (topic.isGeneral || topic.archivedAt !== null) {
    return;
  }
  const rows = await deps.db
    .select({ aiId: topicAis.aiId, owner: ais.owner, status: ais.status })
    .from(topicAis)
    .innerJoin(ais, eq(ais.id, topicAis.aiId))
    .where(eq(topicAis.topicId, topic.id));
  for (const row of rows) {
    const allowed = await aiMayBeInTopic(deps.db, topic, {
      id: row.aiId,
      owner: row.owner,
      status: row.status,
    });
    if (!allowed) {
      emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId: row.aiId });
    }
  }
}

export const addTopicAiBodySchema = z.object({ aiId: z.string().min(1) }).strict();

export type AddTopicAiBody = z.infer<typeof addTopicAiBodySchema>;

// T-0116: attach roles to a topic and pick its approver role. The actor
// must be a topic manager (creator or group owner/admin) who can see the
// topic — the same rule as every other `PUT` here. Only roles of the
// topic's group count, and only for private topics: roles are meaningless
// on a public one, like `memberIds`. The approver role may be null
// ("Owner and admins only"). The room re-syncs so new holders join and
// removed holders leave.
export const setTopicRolesBodySchema = z
  .object({
    roleIds: z.array(z.string().min(1)).max(20),
    approverRoleId: z.string().min(1).nullable(),
  })
  .strict();

export type SetTopicRolesBody = z.infer<typeof setTopicRolesBodySchema>;

export interface SetTopicRolesInput extends SetTopicRolesBody {
  topicId: string;
  actorId: string;
}

export async function setTopicRoles(
  deps: TopicServiceDeps,
  input: SetTopicRolesInput,
): Promise<TopicRow> {
  const topic = await requireManagedTopic(deps.db, input.topicId, input.actorId);
  if (topic.visibility !== 'private') {
    throw new HttpError(400, 'not_private', 'Only private topics have roles');
  }
  if (topic.isGeneral) {
    throw new HttpError(400, 'not_private', 'The General topic is public');
  }
  const roles = await deps.db
    .select()
    .from(groupRoles)
    .where(eq(groupRoles.groupId, topic.groupId));
  const byId = new Map(roles.map((role) => [role.id, role]));
  const wanted = [...new Set(input.roleIds)];
  if (wanted.some((id) => !byId.has(id))) {
    throw new HttpError(400, 'invalid_request', 'Roles must belong to the topic’s group');
  }
  if (input.approverRoleId !== null && !byId.has(input.approverRoleId)) {
    throw new HttpError(
      400,
      'invalid_request',
      'The approver role must belong to the topic’s group',
    );
  }
  const current = await deps.db
    .select({ roleId: topicRoleAccess.roleId })
    .from(topicRoleAccess)
    .where(eq(topicRoleAccess.topicId, topic.id));
  const currentIds = new Set(current.map((row) => row.roleId));
  const wantedIds = new Set(wanted);
  const added = wanted.filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !wantedIds.has(id));
  if (added.length > 0) {
    await deps.db
      .insert(topicRoleAccess)
      .values(added.map((roleId) => ({ topicId: topic.id, roleId })))
      .onConflictDoNothing();
  }
  if (removed.length > 0) {
    await deps.db
      .delete(topicRoleAccess)
      .where(and(eq(topicRoleAccess.topicId, topic.id), inArray(topicRoleAccess.roleId, removed)));
  }
  const approverChanged = (topic.approverRoleId ?? null) !== input.approverRoleId;
  if (approverChanged) {
    await deps.db
      .update(topics)
      .set({ approverRoleId: input.approverRoleId, updatedAt: new Date() })
      .where(eq(topics.id, topic.id));
  }
  const [updated] = await deps.db.select().from(topics).where(eq(topics.id, topic.id)).limit(1);
  if (!updated) {
    throw toMissingTopic();
  }
  // The audit block runs even when the room sync below fails: the database
  // already committed, so the change is real and the log must say so. The
  // caller still sees the 502 and the room heals on the next write.
  if (deps.audit) {
    for (const roleId of added) {
      await deps.audit.record(toAuditEntry(updated, 'topic.role_added', input.actorId, { roleId }));
    }
    for (const roleId of removed) {
      await deps.audit.record(
        toAuditEntry(updated, 'topic.role_removed', input.actorId, { roleId }),
      );
    }
    if (approverChanged) {
      await deps.audit.record(
        toAuditEntry(
          updated,
          'topic.approver_role_set',
          input.actorId,
          input.approverRoleId === null ? {} : { roleId: input.approverRoleId },
        ),
      );
    }
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  return updated;
}

export interface AddTopicAiInput {
  topicId: string;
  actorId: string;
  aiId: string;
}

// Adds an AI to a non-General topic. The actor must own the AI and see the
// topic (`canSeeTopic`); the AI must be an active member of the group.
// General membership is `group_ais`, so adding there answers 400
// `already_in_general`. Anyone else — a plain member who is not the owner,
// an owner who cannot see a private topic — gets the same 404 as a missing
// id. Adding an AI that is already there answers 200 with the topic.
export async function addTopicAi(
  deps: TopicServiceDeps,
  input: AddTopicAiInput,
): Promise<TopicRow> {
  const topic = await getTopic(deps.db, input.topicId);
  const canSee = topic !== null && (await canSeeTopic(deps.db, topic, input.actorId));
  if (!topic || topic.archivedAt !== null || !canSee) {
    throw toMissingTopic();
  }
  if (topic.isGeneral) {
    throw new HttpError(
      400,
      'already_in_general',
      'General membership is managed through the group',
    );
  }
  const [ai] = await deps.db
    .select({ id: ais.id, owner: ais.owner, status: ais.status })
    .from(ais)
    .where(eq(ais.id, input.aiId))
    .limit(1);
  // A foreign or missing AI is the same 404, so AI ids cannot be probed.
  if (!ai || ai.owner !== input.actorId) {
    throw toMissingTopic();
  }
  const [groupRow] = await deps.db
    .select({ aiId: groupAis.aiId })
    .from(groupAis)
    .where(and(eq(groupAis.groupId, topic.groupId), eq(groupAis.aiId, input.aiId)))
    .limit(1);
  if (!groupRow) {
    throw new HttpError(400, 'invalid_request', 'The AI must be in the group first');
  }
  if (ai.status !== 'active') {
    throw new HttpError(400, 'invalid_request', 'Only an active AI can be added to a topic');
  }

  await deps.db
    .insert(topicAis)
    .values({ topicId: topic.id, aiId: input.aiId, addedBy: input.actorId })
    .onConflictDoNothing();
  const [updated] = await deps.db.select().from(topics).where(eq(topics.id, topic.id)).limit(1);
  if (!updated) {
    throw toMissingTopic();
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(
      toAuditEntry(updated, 'topic.ai_added', input.actorId, { aiId: ai.id }),
    );
  }
  emitTopicAi({ type: 'ai-added', topicId: topic.id, aiId: input.aiId });
  return updated;
}

// Removes an AI from a topic: the AI's owner, or a topic manager. A stranger
// — or anyone who cannot see the topic — gets the same 404 as a missing id.
export async function removeTopicAi(
  deps: TopicServiceDeps,
  topicId: string,
  actorId: string,
  aiId: string,
): Promise<TopicRow> {
  const topic = await getTopic(deps.db, topicId);
  const canSee = topic !== null && (await canSeeTopic(deps.db, topic, actorId));
  if (!topic || topic.archivedAt !== null || !canSee) {
    throw toMissingTopic();
  }
  if (topic.isGeneral) {
    throw new HttpError(
      400,
      'already_in_general',
      'General membership is managed through the group',
    );
  }
  const [existing] = await deps.db
    .select({ aiId: topicAis.aiId })
    .from(topicAis)
    .where(and(eq(topicAis.topicId, topic.id), eq(topicAis.aiId, aiId)))
    .limit(1);
  if (!existing) {
    throw new HttpError(404, 'not_found', 'That AI is not in this topic');
  }
  const [ai] = await deps.db
    .select({ id: ais.id, owner: ais.owner })
    .from(ais)
    .where(eq(ais.id, aiId))
    .limit(1);
  const isAiOwner = ai !== undefined && ai.owner === actorId;
  if (!isAiOwner && !(await canManageTopic(deps.db, topic, actorId))) {
    throw toMissingTopic();
  }
  await deps.db
    .delete(topicAis)
    .where(and(eq(topicAis.topicId, topic.id), eq(topicAis.aiId, aiId)));
  // T-0110: removing the AI from the topic revokes its rules and deletes
  // its tools in that topic. Personal-chat rows are unaffected.
  const now = new Date();
  await revokeActiveRulesForAiInTopic(deps.db, { aiId, topicId: topic.id, actorId, now });
  await deleteToolsForAiInTopic(deps.db, { aiId, topicId: topic.id, now });
  await deleteRoutinesForAiInTopic(deps.db, { aiId, topicId: topic.id, now });
  const [updated] = await deps.db.select().from(topics).where(eq(topics.id, topic.id)).limit(1);
  if (!updated) {
    throw toMissingTopic();
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(updated, 'topic.ai_removed', actorId, { aiId }));
  }
  emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId });
  return updated;
}

function mapXmppError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  // A name/localpart race against a concurrent create lands here (the
  // pre-check passed, the unique index refused): answer 409 like the
  // pre-check does, not 503.
  if (isUniqueViolation(error)) {
    return new HttpError(409, 'topic_exists', 'A topic with that name already exists');
  }
  return new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

async function destroyQuietly(
  adminClient: EjabberdAdminClient,
  roomLocalpart: string,
): Promise<void> {
  if (roomLocalpart === '') {
    return;
  }
  try {
    await adminClient.destroyRoom(roomLocalpart);
  } catch {
    // Best effort: the database rows are rolled back either way.
  }
}
