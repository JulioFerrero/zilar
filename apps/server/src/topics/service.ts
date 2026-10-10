import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import {
  canCreateTopic,
  canManageTopic,
  getGroupMembership,
  getTopic,
  requireVisibleTopic,
  toMissingTopic,
  type TopicRow,
} from './access';
import { assertLink, assertMembersAreGroupMembers, assertNameFree, assertOwner } from './members';
import { deleteTopicRows, uniqueRoomLocalpart } from './queries';
import { emitDroppedTopicAis } from './roles';
import { syncTopicRoom } from './rooms';
import {
  defaultGlyph,
  toAuditEntry,
  type CreateTopicInput,
  type PatchTopicBody,
  type TopicServiceDeps,
} from './schemas';

export { auditDetail, defaultGlyph } from './schemas';
export type {
  CreateTopicBody,
  CreateTopicInput,
  PatchTopicBody,
  TopicServiceDeps,
} from './schemas';
export { listTopicMembers } from './queries';
export { addTopicMember, removeTopicMember } from './members';
export { setTopicRoles } from './roles';
export type { AddTopicAiBody, SetTopicRolesBody, SetTopicRolesInput } from './roles';
export { addTopicAi, removeTopicAi } from './ais';
export type { AddTopicAiInput } from './ais';

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
