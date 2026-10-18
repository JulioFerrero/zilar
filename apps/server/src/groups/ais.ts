import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { findOwnedAi } from '../ais/queries';
import { deleteRoomMemoryEffect } from '../agents/memory/state';
import { deleteRoutinesForAiInGroupEffect } from '../routines/deletes';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import { cancelPendingActionsForAi } from '../actions/topic-recheck';
import { invalidateTopicFollow } from '../agents/gateway/topic-follow';
import { revokeActiveRulesForAiInGroupEffect } from '../approvals/rules';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { deleteToolsForAiInGroupEffect } from '../tools/service';
import type { TopicRow } from '../topics/access';
import { syncTopicRoom } from '../topics/rooms';
import { emitGroupAi } from './events';
import { getGroupDetail, getMembership, requireGroup } from './queries';
import {
  MAX_GROUP_MEMBERS,
  mapXmppError,
  type AddGroupAiInput,
  type GroupDetail,
  type RemoveGroupAiInput,
} from './schemas';
import { syncGroupTopicRooms } from './topic-rooms';

export {
  archiveDrainedPrivateTopics,
  emitDroppedGroupTopicAis,
  syncGroupTopicRooms,
} from './topic-rooms';

// A foreign AI answers the same 404 as a missing one, so AI ids cannot be
// probed; people and AIs share MAX_GROUP_MEMBERS. In a channel an
// admin-owned AI joins with voice (`admin`), anything else as `member`.
export async function addGroupAi(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: AddGroupAiInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!actor) {
    throw new HttpError(403, 'forbidden', 'Not a member of this group');
  }
  if (actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can add members');
  }
  const ai = await findOwnedAi(db, input.aiId, input.actorId);
  if (!ai) {
    throw new HttpError(404, 'not_found', 'AI not found');
  }

  const [existing] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${input.groupId} AND ai_id = ${input.aiId} LIMIT 1`;
    }),
  );
  if (existing) {
    const detail = await getGroupDetail(db, input.groupId);
    if (!detail) {
      throw new Error('group disappeared while adding an AI');
    }
    return detail;
  }
  // A stopped (kill switch) or still-provisioning AI cannot join a room; an
  // AI already in it is left alone by the branch above.
  if (ai.status !== 'active') {
    throw new HttpError(409, 'ai_not_active', 'Resume the AI before adding it to a group');
  }

  const [memberRows, aiRows] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const members = yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${input.groupId}`;
      const aiLinks = yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${input.groupId}`;
      return [members, aiLinks] as const;
    }),
  );
  if (memberRows.length + aiRows.length + 1 > MAX_GROUP_MEMBERS) {
    throw new HttpError(400, 'invalid_request', `A group has at most ${MAX_GROUP_MEMBERS} members`);
  }

  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            // Take the per-group join lock before counting, so two concurrent adds
            // cannot each pass the pre-check and exceed the cap; the locked count is
            // the authority.
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-join:' + input.groupId}))`;
            // Recheck inside the lock: a racing add of the same AI already wrote the
            // row, so answer 200 instead of counting it twice and failing 400 at a
            // full group.
            const [lockedExisting] = yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
              WHERE group_id = ${input.groupId} AND ai_id = ${input.aiId} LIMIT 1`;
            if (lockedExisting) {
              return;
            }
            const [memberCount] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM group_members WHERE group_id = ${input.groupId}`;
            const [aiCount] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
              FROM group_ais WHERE group_id = ${input.groupId}`;
            if (
              Number(memberCount?.total ?? 0) + Number(aiCount?.total ?? 0) + 1 >
              MAX_GROUP_MEMBERS
            ) {
              return yield* Effect.fail(
                new HttpError(
                  400,
                  'invalid_request',
                  `A group has at most ${MAX_GROUP_MEMBERS} members`,
                ),
              );
            }
            yield* Effect.tryPromise({
              try: () => adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'member'),
              catch: (error) => error,
            });
            // The lock serializes adds, so the loser sees the winner's row in the
            // recheck; `ON CONFLICT` keeps the insert idempotent.
            yield* sql`INSERT INTO group_ais (group_id, ai_id, added_by)
              VALUES (${input.groupId}, ${input.aiId}, ${input.actorId})
              ON CONFLICT (group_id, ai_id) DO NOTHING`;
          }),
        );
      }),
    );
  } catch (error) {
    throw mapXmppError(error);
  }
  // A fresh AI row is written as `member`, which is voiceless in a channel,
  // so the feed room re-syncs after the commit; best effort, the next sync
  // heals it.
  if (group.kind === 'channel') {
    try {
      const [feed] = await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<TopicRow>`SELECT * FROM topics
            WHERE group_id = ${input.groupId} AND is_general = true LIMIT 1`;
        }),
      );
      if (feed) {
        await syncTopicRoom({ db, adminClient, domain: input.domain, logger: input.logger }, feed);
      }
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not sync the channel feed for a new AI');
    }
  }

  emitGroupAi({ type: 'ai-added', groupId: input.groupId, aiId: input.aiId });
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while adding an AI');
  }
  return detail;
}

// Removes an AI: its owner or a group owner/admin; the AI owner need not
// still be a group member.
export async function removeGroupAi(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: RemoveGroupAiInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  // Authorize before reading the group's AIs, so a caller who may not remove
  // the AI cannot learn whether it is in the group (404 vs 403).
  const [ai] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; jid: string; owner: string }>`SELECT id, jid, owner
        FROM ais WHERE id = ${input.aiId} LIMIT 1`;
    }),
  );
  const actor = await getMembership(db, input.groupId, input.actorId);
  const isAiOwner = ai !== undefined && ai.owner === input.actorId;
  const isGroupManager = actor !== null && actor.role !== 'member';
  if (!isAiOwner && !isGroupManager) {
    throw new HttpError(
      403,
      'forbidden',
      'Only the AI owner or a group owner or admin can remove it',
    );
  }

  const [membership] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
        WHERE group_id = ${input.groupId} AND ai_id = ${input.aiId} LIMIT 1`;
    }),
  );
  if (!membership || !ai) {
    throw new HttpError(404, 'not_found', 'That AI is not in this group');
  }

  // Topic rooms read inside the transaction, so each room's follow cache can
  // be dropped after the commit.
  let topicRows: ReadonlyArray<{ id: string; roomLocalpart: string }> = [];
  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'none'),
              catch: (error) => error,
            });
            yield* sql`DELETE FROM group_ais
              WHERE group_id = ${input.groupId} AND ai_id = ${input.aiId}`;
            // Removing the AI deletes its rows from every topic of the group in the
            // same transaction; each non-General topic room re-syncs after the commit.
            topicRows = yield* sql<{ id: string; roomLocalpart: string }>`SELECT id,
              room_localpart FROM topics WHERE group_id = ${input.groupId}`;
            const topicIds = topicRows.map((row) => row.id);
            if (topicIds.length > 0) {
              yield* sql`DELETE FROM topic_ais
                WHERE topic_id IN ${sql.in(topicIds)} AND ai_id = ${input.aiId}`;
            }
            // The removed AI stops owning or following any topic of the group, General included.
            yield* sql`UPDATE topics SET owner_ai_id = NULLIF(owner_ai_id, ${input.aiId}), follower_ai_id = NULLIF(follower_ai_id, ${input.aiId}), updated_at = now()
              WHERE group_id = ${input.groupId} AND (owner_ai_id = ${input.aiId} OR follower_ai_id = ${input.aiId})`;
            // An `always` rule tied to this (AI, group) pair dies with the membership;
            // personal and other-group rules are unaffected. `now` matches the
            // timestamp the admin client saw so audit rows line up.
            yield* revokeActiveRulesForAiInGroupEffect({
              aiId: input.aiId,
              groupId: input.groupId,
              actorId: input.actorId,
              now: new Date(),
            });
            yield* deleteToolsForAiInGroupEffect({
              aiId: input.aiId,
              groupId: input.groupId,
              now: new Date(),
            });
            yield* deleteRoutinesForAiInGroupEffect({
              aiId: input.aiId,
              groupId: input.groupId,
              now: new Date(),
            });
            yield* deleteRoomMemoryEffect(input.aiId, [
              ...new Set([group.roomLocalpart, ...topicRows.map((row) => row.roomLocalpart)]),
            ]);
          }),
        );
      }),
    );
  } catch (error) {
    throw mapXmppError(error);
  }

  await cancelPendingActionsForAi(
    { db, logger: input.logger },
    { aiId: input.aiId, groupId: input.groupId },
    new Date(),
  );

  for (const topic of topicRows) {
    invalidateTopicFollow(topic.roomLocalpart);
  }

  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
  emitGroupAi({ type: 'ai-removed', groupId: input.groupId, aiId: input.aiId });
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing an AI');
  }
  return detail;
}
