import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { HttpError } from '../errors';
import { runSql } from '../effect/sql';
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
