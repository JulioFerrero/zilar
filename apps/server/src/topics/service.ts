import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { cancelPendingActionsForAi } from '../actions/topic-recheck';
import { invalidateTopicFollow } from '../agents/gateway/topic-follow';
import { deleteRoomMemoryEffect } from '../agents/memory/state';
import { deleteRoutinesForAiInTopic } from '../routines/deletes';
import { revokeActiveRulesForAiInTopic } from '../approvals/rules';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { addGroupAi } from '../groups/ais';
import { emitTopicAi } from '../groups/events';
import { deleteToolsForAiInTopicEffect } from '../tools/service';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import {
  canCreateTopic,
  canManageTopic,
  canSeeTopic,
  getGroupMembership,
  getTopic,
  toMissingTopic,
  type TopicRow,
} from './access';
import {
  assertLink,
  assertMembersAreGroupMembers,
  assertNameFree,
  assertOwner,
  finishTopicAdd,
} from './members';
import { deleteTopicRows, uniqueRoomLocalpart } from './queries';
import { syncTopicRoom } from './rooms';
import {
  defaultGlyph,
  toAuditEntry,
  type CreateTopicInput,
  type TopicServiceDeps,
} from './schemas';
import { patchTopic } from './patch';

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
  // a channel has no topics beyond its General feed.
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
    // Private topics carry the invited members; a public topic starts with only
    // its creator, and others join from "Other topics".
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
    // Roll the row back when the insert raced another writer: the room is gone
    // either way.
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
  // A name/localpart race lands here (the pre-check passed, the unique index
  // refused): answer 409, not 503.
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

export interface AddTopicAiInput {
  topicId: string;
  actorId: string;
  aiId: string;
}

// Adds an AI to a non-General topic: the actor must own the AI and see the
// topic, and the AI must be an active group member. General membership is
// `group_ais`, so adding there answers 400 `already_in_general`. Anyone else
// gets the same 404 as a missing id; a duplicate add answers 200.
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
    // The one-step add: a missing group membership is created first by
    // `addGroupAi`, with its own rules and refusals, so a plain member who may
    // add to the topic still cannot add to the group.
    await addGroupAi(deps.db, deps.adminClient, {
      groupId: topic.groupId,
      actorId: input.actorId,
      aiId: input.aiId,
      domain: deps.domain,
      logger: deps.logger,
    });
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
  const updated = await finishTopicAdd(deps, topic.id, input.actorId, 'topic.ai_added', {
    aiId: ai.id,
  });
  emitTopicAi({ type: 'ai-added', topicId: topic.id, aiId: input.aiId });
  return updated;
}

// Removes an AI: its owner or a topic manager; a stranger or anyone who
// cannot see the topic gets the same 404.
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
      yield* sql`
        DELETE FROM topic_ais WHERE topic_id = ${topic.id} AND ai_id = ${aiId}`;
      // A removed AI stops owning or following the topic (`NULLIF` clears only
      // this AI), so the owner chip never names an absent AI.
      yield* sql`
        UPDATE topics SET
          owner_ai_id = NULLIF(owner_ai_id, ${aiId}),
          follower_ai_id = NULLIF(follower_ai_id, ${aiId}),
          updated_at = now()
        WHERE id = ${topic.id}
          AND (owner_ai_id = ${aiId} OR follower_ai_id = ${aiId})`;
    }),
  );
  // Drop the room's cached follow lookup, so a plain message cannot wake the
  // ex-owner for up to 15 s.
  invalidateTopicFollow(topic.roomLocalpart);
  // Removing the AI revokes its rules and deletes its tools in that topic;
  // personal-chat rows are unaffected.
  const now = new Date();
  await revokeActiveRulesForAiInTopic(deps.db, { aiId, topicId: topic.id, actorId, now });
  await runSql(deps.db, deleteToolsForAiInTopicEffect({ aiId, topicId: topic.id, now }));
  await deleteRoutinesForAiInTopic(deps.db, { aiId, topicId: topic.id, now });
  // The AI's memory of this topic room dies with the membership; its DM
  // memory and other rooms are unaffected.
  await runSql(deps.db, deleteRoomMemoryEffect(aiId, [topic.roomLocalpart]));
  // The AI's waiting actions in this topic die with the membership.
  await cancelPendingActionsForAi(
    { db: deps.db, logger: deps.logger },
    { aiId, groupId: topic.groupId, topicId: topic.id },
    now,
  );
  const updated = await getTopic(deps.db, topic.id);
  if (!updated) {
    throw toMissingTopic();
  }
  try {
    await syncTopicRoom(deps, updated);
  } catch (error) {
    throw error instanceof HttpError ? error : xmppUnavailable();
  }
  if (deps.audit) {
    await deps.audit.record(toAuditEntry(updated, 'topic.ai_removed', actorId, { aiId }));
  }
  emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId });
  return updated;
}
