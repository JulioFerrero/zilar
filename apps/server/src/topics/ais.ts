import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { deleteRoomMemoryEffect } from '../agents/memory/store';
import { revokeActiveRulesForAiInTopic } from '../approvals/rules';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { emitTopicAi } from '../groups/events';
import { deleteRoutinesForAiInTopic } from '../routines/service';
import { deleteToolsForAiInTopicEffect } from '../tools/service';
import { canManageTopic, canSeeTopic, getTopic, toMissingTopic, type TopicRow } from './access';
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
