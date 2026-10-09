import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
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
  type TopicKind,
  type TopicRow,
  type TopicStatus,
  type TopicVisibility,
} from './access';
import { emitTopicAi } from '../groups/events';
import { revokeActiveRulesForAiInTopic } from '../approvals/rules';
import { deleteRoutinesForAiInTopic } from '../routines/service';
import { deleteRoomMemoryEffect } from '../agents/memory/store';
import { deleteToolsForAiInTopicEffect } from '../tools/service';
import { sqlRuntimeFor } from '../effect/sql';
import { syncTopicRoom } from './rooms';

export const TOPIC_NAME_MAX = 80;
export const TOPIC_LINK_URL_MAX = 300;
export const TOPIC_LINK_LABEL_MAX = 40;

// The request bodies are validated at the Effect HTTP boundary in `api.ts`;
// these are the shapes the service accepts.
export interface CreateTopicBody {
  name: string;
  kind?: TopicKind | undefined;
  visibility?: TopicVisibility | undefined;
  memberIds?: string[] | undefined;
  glyph?: string | undefined;
  owner?: { kind: 'user' | 'ai'; id: string } | null | undefined;
  linkUrl?: string | null | undefined;
  linkLabel?: string | null | undefined;
}

export interface PatchTopicBody {
  name?: string | undefined;
  glyph?: string | undefined;
  kind?: TopicKind | undefined;
  status?: TopicStatus | undefined;
  owner?: { kind: 'user' | 'ai'; id: string } | null | undefined;
  linkUrl?: string | null | undefined;
  linkLabel?: string | null | undefined;
  archived?: true | undefined;
  visibility?: TopicVisibility | undefined;
  memberIds?: string[] | undefined;
  confirmExposeHistory?: boolean | undefined;
}

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
    const [existing] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ id: string }>`
          SELECT id FROM topics WHERE room_localpart = ${localpart} LIMIT 1`;
      }),
    );
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
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
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
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais WHERE id = ${owner.id} LIMIT 1`;
    }),
  );
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
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        SELECT user_id FROM group_members
        WHERE group_id = ${groupId} AND user_id IN ${sql.in(memberIds)}`;
    }),
  );
  const known = new Set(rows.map((row) => row.userId));
  if (memberIds.some((id) => !known.has(id))) {
    throw new HttpError(400, 'invalid_request', 'Topic members must be group members');
  }
}

// Removes a half-created topic: its member rows first, then the topic row.
async function deleteTopicRows(db: ServerDatabase, topicId: string): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM topic_members WHERE topic_id = ${topicId}`;
      yield* sql`DELETE FROM topics WHERE id = ${topicId}`;
    }),
  );
}

export async function createTopic(
  deps: TopicServiceDeps,
  input: CreateTopicInput,
): Promise<TopicRow> {
  const [group] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ kind: string; membersCanCreateTopics: boolean }>`
        SELECT * FROM groups WHERE id = ${input.groupId} LIMIT 1`;
    }),
  );
  const membership = group ? await getGroupMembership(deps.db, input.groupId, input.actorId) : null;
  // A stranger sees the same 404 as a missing group.
  if (!group || !membership) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  // T-0124: a channel has no topics beyond its General feed.
  if (group.kind === 'channel') {
    throw new HttpError(400, 'channel_has_no_topics', 'Channels have no topics');
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
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topics ${sql.insert({
          id: topicId,
          group_id: input.groupId,
          name: input.name,
          glyph: input.glyph ?? defaultGlyph(input.name),
          room_localpart: roomLocalpart,
          visibility,
          kind: input.kind ?? 'chat',
          status: 'open',
          owner_user_id: ownerUserId,
          owner_ai_id: ownerAiId,
          link_url: input.linkUrl ?? null,
          link_label: input.linkLabel ?? null,
          is_general: false,
          created_by: input.actorId,
        })}`;
      }),
    );
    if (visibility === 'private') {
      await runSql(
        deps.db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO topic_members ${sql.insert(
            memberIds.map((userId) => ({
              topic_id: topicId,
              user_id: userId,
              added_by: input.actorId,
            })),
          )}`;
        }),
      );
    }
  } catch (error) {
    if (roomCreated || roomLocalpart !== '') {
      await destroyQuietly(deps.adminClient, roomLocalpart);
    }
    // Roll the row back when the insert raced another writer (name or
    // localpart clashed after the check): the room is gone either way.
    await deleteTopicRows(deps.db, topicId);
    throw mapXmppError(error);
  }

  const topic = await getTopic(deps.db, topicId);
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
    await deleteTopicRows(deps.db, topicId);
    throw error instanceof HttpError
      ? error
      : new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(topic, 'topic.created', input.actorId));
  }
  return topic;
}

// effect/sql writes column names as given (the client has no query-name
// transform), so the camelCase patch becomes snake_case columns first.
function snakeCaseKeys(patch: Partial<TopicRow>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
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

  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE topics SET ${sql.update(snakeCaseKeys(patch))} WHERE id = ${topic.id}`;
    }),
  );
  if (goingPrivate) {
    const memberIds = [...new Set(input.memberIds ?? [])];
    if (!memberIds.includes(input.actorId)) {
      memberIds.push(input.actorId);
    }
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topic_members ${sql.insert(
          memberIds.map((userId) => ({
            topic_id: topic.id,
            user_id: userId,
            added_by: input.actorId,
          })),
        )} ON CONFLICT DO NOTHING`;
      }),
    );
  }
  // Going public ends everything private access rested on: direct members,
  // attached roles and the approver role. Clearing the roles now keeps them
  // from silently coming back if the topic is made private again.
  let clearedRoleIds: string[] = [];
  if (goingPublic) {
    clearedRoleIds = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DELETE FROM topic_members WHERE topic_id = ${topic.id}`;
        const attached = yield* sql<{ roleId: string }>`
          SELECT role_id FROM topic_role_access WHERE topic_id = ${topic.id}`;
        yield* sql`DELETE FROM topic_role_access WHERE topic_id = ${topic.id}`;
        yield* sql`UPDATE topics SET approver_role_id = NULL WHERE id = ${topic.id}`;
        return attached.map((row) => row.roleId);
      }),
    );
  }

  const updated = await getTopic(deps.db, topic.id);
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
    for (const roleId of clearedRoleIds) {
      await deps.audit.record(
        toAuditEntry(updated, 'topic.role_removed', input.actorId, { roleId }),
      );
    }
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
    const rows = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string; name: string }>`
          SELECT group_members.user_id, "user".name
          FROM group_members
          INNER JOIN "user" ON "user".id = group_members.user_id
          WHERE group_members.group_id = ${topic.groupId}`;
      }),
    );
    return [...rows].sort(
      (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
    );
  }
  // T-0116: direct members plus the holders of the topic's roles (still
  // group members). Everyone holding the topic can see the full list: role
  // membership is not secret.
  const [direct, holders] = await Promise.all([
    runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ userId: string }>`
          SELECT user_id FROM topic_members WHERE topic_id = ${topic.id}`;
      }),
    ),
    topicRoleHolderIds(deps.db, topic.id, topic.groupId),
  ]);
  const ids = new Set(direct.map((row) => row.userId));
  for (const id of holders) {
    ids.add(id);
  }
  if (ids.size === 0) {
    return [];
  }
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string; name: string }>`
        SELECT id AS user_id, name FROM "user" WHERE id IN ${sql.in([...ids])}`;
    }),
  );
  // `topic_members` rows for users who left the group no longer count (the
  // room sync drops them too); the join above only returns live users.
  const memberRows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        SELECT user_id FROM group_members WHERE group_id = ${topic.groupId}`;
    }),
  );
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
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        INSERT INTO topic_members (topic_id, user_id, added_by)
        VALUES (${topic.id}, ${targetUserId}, ${actorId})
        ON CONFLICT DO NOTHING`;
    }),
  );
  const updated = await getTopic(deps.db, topic.id);
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
  const [existing] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        SELECT user_id FROM topic_members
        WHERE topic_id = ${topic.id} AND user_id = ${targetUserId}
        LIMIT 1`;
    }),
  );
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
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        DELETE FROM topic_members WHERE topic_id = ${topic.id} AND user_id = ${targetUserId}`;
    }),
  );

  const remaining = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        SELECT user_id FROM topic_members WHERE topic_id = ${topic.id}`;
    }),
  );
  // T-0116: the topic drains only when the direct rows AND the role holders
  // are gone — a holder the role still grants access to keeps it alive.
  const holders =
    remaining.length === 0
      ? await topicRoleHolderIds(deps.db, topic.id, topic.groupId)
      : new Set<string>();
  let updated = (await getTopic(deps.db, topic.id)) ?? topic;
  if (remaining.length === 0 && holders.size === 0) {
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql`
          UPDATE topics
          SET archived_at = ${new Date().toISOString()}, updated_at = ${new Date().toISOString()}
          WHERE id = ${topic.id}`;
      }),
    );
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

// The topic-AI statements run on the `effect/sql` client registered for this
// database (see `../effect/sql`), like `getTopic` in `./access.ts`.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError | E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
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
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string; owner: string; status: string }>`
        SELECT topic_ais.ai_id, ais.owner, ais.status
        FROM topic_ais
        INNER JOIN ais ON ais.id = topic_ais.ai_id
        WHERE topic_ais.topic_id = ${topic.id}`;
    }),
  );
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

export interface AddTopicAiBody {
  aiId: string;
}

// T-0116: attach roles to a topic and pick its approver role. The actor
// must be a topic manager (creator or group owner/admin) who can see the
// topic — the same rule as every other `PUT` here. Only roles of the
// topic's group count, and only for private topics: roles are meaningless
// on a public one, like `memberIds`. The approver role may be null
// ("Owner and admins only"). The room re-syncs so new holders join and
// removed holders leave.
export interface SetTopicRolesBody {
  roleIds: string[];
  approverRoleId: string | null;
}

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
  const roles = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`
        SELECT * FROM group_roles WHERE group_id = ${topic.groupId}`;
    }),
  );
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
  const wantedIds = new Set(wanted);
  // One transaction under the group's advisory lock, reading the current
  // set INSIDE it: two concurrent PUTs serialize and the second diffs
  // against the first's commit (last-writer-wins, like `setRoleMembers`).
  // The approver update rides the same transaction so access and approver
  // can never disagree.
  const approverChanged = (topic.approverRoleId ?? null) !== input.approverRoleId;
  const diff = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${topic.groupId}))`;
          const rows = yield* sql<{ roleId: string }>`
            SELECT role_id FROM topic_role_access WHERE topic_id = ${topic.id}`;
          const liveIds = new Set(rows.map((row) => row.roleId));
          const nextAdded = wanted.filter((id) => !liveIds.has(id));
          const nextRemoved = [...liveIds].filter((id) => !wantedIds.has(id));
          if (nextAdded.length > 0) {
            yield* sql`INSERT INTO topic_role_access ${sql.insert(
              nextAdded.map((roleId) => ({ topic_id: topic.id, role_id: roleId })),
            )} ON CONFLICT DO NOTHING`;
          }
          if (nextRemoved.length > 0) {
            yield* sql`DELETE FROM topic_role_access
              WHERE topic_id = ${topic.id} AND role_id IN ${sql.in(nextRemoved)}`;
          }
          if (approverChanged) {
            yield* sql`UPDATE topics
              SET approver_role_id = ${input.approverRoleId}, updated_at = now()
              WHERE id = ${topic.id}`;
          }
          return { added: nextAdded, removed: nextRemoved };
        }),
      );
    }),
  );
  const { added, removed } = diff;
  const updated = await getTopic(deps.db, topic.id);
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
  const [ai] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; owner: string; status: string }>`
        SELECT id, owner, status FROM ais WHERE id = ${input.aiId} LIMIT 1`;
    }),
  );
  // A foreign or missing AI is the same 404, so AI ids cannot be probed.
  if (!ai || ai.owner !== input.actorId) {
    throw toMissingTopic();
  }
  const [groupRow] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`
        SELECT ai_id FROM group_ais
        WHERE group_id = ${topic.groupId} AND ai_id = ${input.aiId}
        LIMIT 1`;
    }),
  );
  if (!groupRow) {
    throw new HttpError(400, 'invalid_request', 'The AI must be in the group first');
  }
  if (ai.status !== 'active') {
    throw new HttpError(400, 'invalid_request', 'Only an active AI can be added to a topic');
  }

  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        INSERT INTO topic_ais (topic_id, ai_id, added_by)
        VALUES (${topic.id}, ${input.aiId}, ${input.actorId})
        ON CONFLICT DO NOTHING`;
    }),
  );
  const updated = await getTopic(deps.db, topic.id);
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
  const [existing] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`
        SELECT ai_id FROM topic_ais
        WHERE topic_id = ${topic.id} AND ai_id = ${aiId}
        LIMIT 1`;
    }),
  );
  if (!existing) {
    throw new HttpError(404, 'not_found', 'That AI is not in this topic');
  }
  const [ai] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; owner: string }>`
        SELECT id, owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  const isAiOwner = ai !== undefined && ai.owner === actorId;
  if (!isAiOwner && !(await canManageTopic(deps.db, topic, actorId))) {
    throw toMissingTopic();
  }
  await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        DELETE FROM topic_ais WHERE topic_id = ${topic.id} AND ai_id = ${aiId}`;
    }),
  );
  // T-0110: removing the AI from the topic revokes its rules and deletes
  // its tools in that topic. Personal-chat rows are unaffected.
  const now = new Date();
  await revokeActiveRulesForAiInTopic(deps.db, { aiId, topicId: topic.id, actorId, now });
  await runSql(deps.db, deleteToolsForAiInTopicEffect({ aiId, topicId: topic.id, now }));
  await deleteRoutinesForAiInTopic(deps.db, { aiId, topicId: topic.id, now });
  // T-0442: the AI's memory of this topic room dies with the membership
  // (plan §3.5). Its DM memory and other rooms are unaffected.
  await runSql(deps.db, deleteRoomMemoryEffect(aiId, [topic.roomLocalpart]));
  const updated = await getTopic(deps.db, topic.id);
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
