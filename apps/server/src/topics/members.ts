import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { invalidateTopicFollow } from '../agents/gateway/topic-follow';
import type { ServerDatabase } from '../db/client';
import { HttpError, xmppUnavailable } from '../errors';
import { runSql } from '../effect/sql';
import { addGroupMembers } from '../groups/members';
import { topicRoleHolderIds } from '../roles/service';
import {
  canManageTopic,
  canSeeTopic,
  getGroupMembership,
  getTopic,
  requireManagedTopic,
  toMissingTopic,
  type TopicRow,
} from './access';
import { syncTopicRoom } from './rooms';
import { emitDroppedTopicAis } from './roles';
import { toAuditEntry, type TopicServiceDeps } from './schemas';

export async function assertNameFree(
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

export async function assertOwner(
  db: ServerDatabase,
  groupId: string,
  owner: { kind: 'user' | 'ai'; id: string } | null | undefined,
  topicId?: string,
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
  // T-1448: an AI owner must be one of the topic's AIs, so the owner follows
  // the topic it owns. For a normal topic that is `topic_ais`; the General
  // topic has no `topic_ais` rows, so its AIs are the group's `group_ais`. At
  // create there is no topic yet, so an AI owner is refused the same way.
  if (topicId === undefined) {
    throw new HttpError(400, 'invalid_request', 'Add the AI to the topic first');
  }
  const [linked] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`
        SELECT ai_id FROM topic_ais
        WHERE topic_id = ${topicId} AND ai_id = ${owner.id}
        UNION
        SELECT ga.ai_id FROM group_ais ga
        INNER JOIN topics t ON t.group_id = ga.group_id
        WHERE t.id = ${topicId} AND t.is_general = true AND ga.ai_id = ${owner.id}
        LIMIT 1`;
    }),
  );
  if (!linked) {
    throw new HttpError(400, 'invalid_request', 'Add the AI to the topic first');
  }
  return { ownerUserId: null, ownerAiId: owner.id };
}

export async function assertLink(
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

export async function assertMembersAreGroupMembers(
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

export async function addTopicMember(
  deps: TopicServiceDeps,
  topicId: string,
  actorId: string,
  targetUserId: string,
): Promise<TopicRow> {
  const topic = await requireManagedTopic(deps.db, topicId, actorId);
  if (topic.isGeneral) {
    throw new HttpError(400, 'is_general', 'Everyone in the group is in General');
  }
  const membership = await getGroupMembership(deps.db, topic.groupId, targetUserId);
  if (!membership) {
    // T-1769: the one-step add. A target outside the group joins it first;
    // `addGroupMembers` applies the group rule (owner or admin) and the contact
    // check. A plain member who may manage the topic cannot add to the group.
    await addGroupMembers(deps.db, deps.adminClient, {
      groupId: topic.groupId,
      actorId,
      userIds: [targetUserId],
      domain: deps.domain,
      logger: deps.logger,
    });
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
    throw error instanceof HttpError ? error : xmppUnavailable();
  }
  if (deps.audit) {
    await deps.audit.record(
      toAuditEntry(updated, 'topic.member_added', actorId, { subjectUserId: targetUserId }),
    );
  }
  return updated;
}

// T-1760: a group member joins a public topic themselves. A private topic
// already contains anyone who can see it and General holds everyone, so both
// are no-ops; only a real public insert syncs the room and audits.
export async function joinTopic(
  deps: TopicServiceDeps,
  topicId: string,
  actorId: string,
): Promise<TopicRow> {
  const topic = await getTopic(deps.db, topicId);
  if (!topic || !(await canSeeTopic(deps.db, topic, actorId))) {
    throw toMissingTopic();
  }
  if (topic.isGeneral) {
    throw new HttpError(400, 'is_general', 'Everyone in the group is in General');
  }
  if (topic.visibility === 'private') {
    return topic;
  }
  const inserted = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`
        INSERT INTO topic_members (topic_id, user_id, added_by)
        VALUES (${topic.id}, ${actorId}, ${actorId})
        ON CONFLICT DO NOTHING
        RETURNING user_id`;
    }),
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
  if (inserted.length > 0 && deps.audit) {
    await deps.audit.record(
      toAuditEntry(updated, 'topic.member_added', actorId, { subjectUserId: actorId }),
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
  if (topic.isGeneral) {
    throw new HttpError(400, 'is_general', 'Leaving General is leaving the group');
  }
  const isSelf = actorId === targetUserId;
  // T-1760: on a public topic only the person themselves can leave; a manager
  // cannot remove anyone. This replaces the old `not_private` guard.
  if (topic.visibility !== 'private' && !isSelf) {
    throw new HttpError(403, 'forbidden', 'People leave a public topic themselves');
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
  if (
    topic.visibility === 'private' &&
    !isSelf &&
    !(await canManageTopic(deps.db, topic, actorId))
  ) {
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
    topic.visibility === 'private' && remaining.length === 0
      ? await topicRoleHolderIds(deps.db, topic.id, topic.groupId)
      : new Set<string>();
  let updated = (await getTopic(deps.db, topic.id)) ?? topic;
  // T-1760: only a private topic archives when it drains; a public topic with
  // no members stays live and joinable.
  if (topic.visibility === 'private' && remaining.length === 0 && holders.size === 0) {
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
    // T-1448: archiving drops the room's follow, so a plain message within the
    // 15 s cache window cannot still wake the ex-owner AI.
    invalidateTopicFollow(topic.roomLocalpart);
    updated = (await getTopic(deps.db, topic.id)) ?? topic;
    // The room still holds the just-removed members: desired members is now
    // empty, so the sync below removes everyone from the room.
    try {
      await syncTopicRoom(deps, updated);
    } catch (error) {
      throw error instanceof HttpError ? error : xmppUnavailable();
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
    throw error instanceof HttpError ? error : xmppUnavailable();
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
