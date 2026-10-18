import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { cancelPendingActionsForAi } from '../actions/topic-recheck';
import { invalidateTopicFollow } from '../agents/gateway/topic-follow';
import { deleteRoomMemoryEffect } from '../agents/memory/store';
import { revokeActiveRulesForAiInTopic } from '../approvals/rules';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { addGroupAi } from '../groups/ais';
import { emitTopicAi } from '../groups/events';
import { deleteRoutinesForAiInTopic } from '../routines/service';
import { deleteToolsForAiInTopicEffect } from '../tools/service';
import { canManageTopic, canSeeTopic, getTopic, toMissingTopic, type TopicRow } from './access';
import { finishTopicAdd } from './members';
import { syncTopicRoom } from './rooms';
import { toAuditEntry, type TopicServiceDeps } from './schemas';

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
    // T-1769: the one-step add. A missing group membership is created first by
    // `addGroupAi`, which applies the group rule (owner or admin) and its own
    // refusals. A plain member who may add to the topic cannot add to the group.
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
      yield* sql`
        DELETE FROM topic_ais WHERE topic_id = ${topic.id} AND ai_id = ${aiId}`;
      // T-1455: a removed AI stops owning the topic, so the owner chip never
      // names an AI that is no longer there. T-1529: it also stops following if
      // it was the follower. `NULLIF` clears each only when it is this AI, so a
      // different AI's owner or follower survives.
      yield* sql`
        UPDATE topics SET
          owner_ai_id = NULLIF(owner_ai_id, ${aiId}),
          follower_ai_id = NULLIF(follower_ai_id, ${aiId}),
          updated_at = now()
        WHERE id = ${topic.id}
          AND (owner_ai_id = ${aiId} OR follower_ai_id = ${aiId})`;
    }),
  );
  // T-1448/T-1455: the owner changed, so drop the room's cached follow lookup
  // instead of letting a plain message wake the ex-owner for up to 15 s.
  invalidateTopicFollow(topic.roomLocalpart);
  // T-0110: removing the AI from the topic revokes its rules and deletes
  // its tools in that topic. Personal-chat rows are unaffected.
  const now = new Date();
  await revokeActiveRulesForAiInTopic(deps.db, { aiId, topicId: topic.id, actorId, now });
  await runSql(deps.db, deleteToolsForAiInTopicEffect({ aiId, topicId: topic.id, now }));
  await deleteRoutinesForAiInTopic(deps.db, { aiId, topicId: topic.id, now });
  // T-0442: the AI's memory of this topic room dies with the membership
  // (plan §3.5). Its DM memory and other rooms are unaffected.
  await runSql(deps.db, deleteRoomMemoryEffect(aiId, [topic.roomLocalpart]));
  // T-1991: the AI's waiting actions in this topic die with the membership.
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
