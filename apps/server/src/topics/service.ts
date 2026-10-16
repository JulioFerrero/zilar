import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { canCreateTopic, getGroupMembership, getTopic, type TopicRow } from './access';
import { assertLink, assertMembersAreGroupMembers, assertNameFree, assertOwner } from './members';
import { deleteTopicRows, uniqueRoomLocalpart } from './queries';
import { syncTopicRoom } from './rooms';
import {
  defaultGlyph,
  toAuditEntry,
  type CreateTopicInput,
  type TopicServiceDeps,
} from './schemas';
import { patchTopic } from './patch';

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
          follower_ai_id: ownerAiId,
          link_url: input.linkUrl ?? null,
          link_label: input.linkLabel ?? null,
          is_general: false,
          created_by: input.actorId,
        })}`;
      }),
    );
    // Private topics carry the invited members; a public topic starts with
    // only its creator, and others join it from "Other topics".
    const initialMemberIds = visibility === 'private' ? memberIds : [input.actorId];
    await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO topic_members ${sql.insert(
          initialMemberIds.map((userId) => ({
            topic_id: topicId,
            user_id: userId,
            added_by: input.actorId,
          })),
        )}`;
      }),
    );
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
    throw xmppUnavailable();
  }
  try {
    await syncTopicRoom(deps, topic);
  } catch (error) {
    await destroyQuietly(deps.adminClient, roomLocalpart);
    await deleteTopicRows(deps.db, topicId);
    throw error instanceof HttpError ? error : xmppUnavailable();
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(topic, 'topic.created', input.actorId));
  }
  return topic;
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
  return xmppUnavailable();
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
