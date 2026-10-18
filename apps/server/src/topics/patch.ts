// Patch one topic's fields. Editing the task strip (status, owner, link,
// kind, done) is open to anyone who can see the topic;
// name/glyph/visibility/archive/memberIds need a manager.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { invalidateTopicFollow, pauseFollow, resumeFollow } from '../agents/gateway/topic-follow';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import {
  canManageTopic,
  getTopic,
  requireVisibleTopic,
  toMissingTopic,
  type TopicRow,
} from './access';
import { assertLink, assertMembersAreGroupMembers, assertNameFree, assertOwner } from './members';
import { emitDroppedTopicAis } from './roles';
import { syncTopicRoom } from './rooms';
import { toAuditEntry, type PatchTopicBody, type TopicServiceDeps } from './schemas';

export interface PatchTopicInput extends PatchTopicBody {
  topicId: string;
  actorId: string;
}

// effect/sql writes column names as given, so the camelCase patch becomes
// snake_case first.
function snakeCaseKeys(patch: Partial<TopicRow>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      value,
    ]),
  );
}

export async function patchTopic(
  deps: TopicServiceDeps,
  input: PatchTopicInput,
): Promise<TopicRow> {
  const topic = await requireVisibleTopic(deps.db, input.topicId, input.actorId);
  const isManager = await canManageTopic(deps.db, topic, input.actorId);
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
      : await assertOwner(deps.db, topic.groupId, input.owner, topic.id);
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
  // `true` stamps the flag, `false` clears it; anyone who can see the topic
  // may do either. An AI starting work again does not clear it.
  if (input.done !== undefined) patch.doneAt = input.done ? new Date() : null;
  if (input.owner !== undefined) {
    patch.ownerUserId = ownerUserId ?? null;
    patch.ownerAiId = ownerAiId ?? null;
    // Assigning an AI owner also makes it the follower, so the owner chip
    // follows until the owner is dropped; General is never followed, and
    // clearing the owner leaves the follower.
    if (ownerAiId !== undefined && ownerAiId !== null && !topic.isGeneral) {
      patch.followerAiId = ownerAiId;
    }
    // a new owner never inherits the old owner's Stop pause.
    patch.followPausedAt = null;
  }
  // Marking the topic done pauses its follower, like a Stop, even when a new
  // owner is set in the same request.
  if (input.done === true) {
    patch.followPausedAt = new Date();
  }
  if (input.linkUrl !== undefined) patch.linkUrl = input.linkUrl ?? null;
  if (input.linkLabel !== undefined) patch.linkLabel = input.linkLabel ?? null;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  if (input.archived === true) patch.archivedAt = new Date();
  // Who follows once this update lands: the AI owner set here, otherwise the
  // current follower. `done` pauses it.
  const nextFollowerAiId = patch.followerAiId ?? topic.followerAiId;

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
  // A new owner, the archive flag or done decides who follows, so drop the
  // cached lookup. Re-assigning an AI owner clears its Stop pause.
  if (input.owner !== undefined || input.archived !== undefined || input.done !== undefined) {
    invalidateTopicFollow(topic.roomLocalpart);
    if (ownerAiId !== undefined && ownerAiId !== null && input.done !== true) {
      resumeFollow(ownerAiId, topic.roomLocalpart);
    }
  }
  // Marking done pauses the post-update follower, not the pre-update row.
  if (input.done === true && nextFollowerAiId !== null) {
    pauseFollow(nextFollowerAiId, topic.roomLocalpart);
  }
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
  // Going public ends what private access rested on: attached roles and the
  // approver role; direct members stay. Clearing them now keeps them from
  // coming back if the topic goes private again.
  let clearedRoleIds: string[] = [];
  if (goingPublic) {
    clearedRoleIds = await runSql(
      deps.db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
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
    throw error instanceof HttpError ? error : xmppUnavailable();
  }
  // A public-to-private change may leave AIs whose owner is not in
  // `memberIds`; they drop out of the room (rows stay).
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
