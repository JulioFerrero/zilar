import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { findOwnedAi } from '../ais/queries';
import { deleteRoomMemoryEffect } from '../agents/memory/state';
import { deleteRoutinesForAiInGroupEffect } from '../routines/deletes';
import { type EjabberdAdminClient } from '../xmpp/admin/types';
import { cancelPendingActionsForAi } from '../actions/topic-recheck';
import { invalidateTopicFollow } from '../agents/gateway/topic-follow';
import { revokeActiveRulesForAiInGroupEffect } from '../approvals/rules';
import { type ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { deleteToolsForAiInGroupEffect } from '../tools/service';
import { type TopicRow, aiMayBeInTopic } from '../topics/access';
import { syncTopicRoom, type TopicRoomDeps } from '../topics/rooms';
import { emitGroupAi, emitTopicAi } from './events';
import { getGroupDetail, getMembership, requireGroup } from './queries';
import {
  MAX_GROUP_MEMBERS,
  mapXmppError,
  type AddGroupAiInput,
  type GroupDetail,
  type RemoveGroupAiInput,
  type InviteLogger,
} from './schemas';
import { topicRoleHolderIds } from '../roles/service';
// A group whose topic-room sync failed is retried every minute until the
// rooms match the database again, archived rooms included, so a failed
// removal leaves nothing stale. Idempotent, in-memory: a restart drops the
// retry and the next membership change notes the group again.
const RETRY_INTERVAL_MS = 60_000;

const pending = new Map<string, TopicRoomDeps>();
let retryTimer: NodeJS.Timeout | undefined;

// Remembers the group and starts the retry lazily; `unref` keeps the timer
// from holding the process open.
function notePendingGroupSync(groupId: string, deps: TopicRoomDeps): void {
  pending.set(groupId, deps);
  if (retryTimer === undefined) {
    retryTimer = setInterval(() => {
      void drainPendingGroupSyncs();
    }, RETRY_INTERVAL_MS);
    retryTimer.unref();
  }
}

// One pass over pending groups; a group is dropped only when every room
// synced, else it stays for the next pass. Exported for the test.
export async function drainPendingGroupSyncs(): Promise<void> {
  for (const [groupId, deps] of pending) {
    const synced = await syncPendingGroup(groupId, deps);
    if (synced) {
      pending.delete(groupId);
    }
  }
}

export function stopRoomSyncRetry(): void {
  if (retryTimer !== undefined) {
    clearInterval(retryTimer);
    retryTimer = undefined;
  }
}

async function syncPendingGroup(groupId: string, deps: TopicRoomDeps): Promise<boolean> {
  let topics: TopicRow[];
  try {
    topics = await pendingGroupTopics(deps, groupId);
  } catch {
    deps.logger.warn({ groupId }, 'could not read the topics of a pending group');
    return false;
  }

  let synced = true;
  for (const topic of topics) {
    try {
      await syncTopicRoom(deps, topic);
    } catch {
      deps.logger.warn({ groupId }, 'could not retry a topic room sync');
      synced = false;
    }
  }
  return synced;
}

async function pendingGroupTopics(deps: TopicRoomDeps, groupId: string): Promise<TopicRow[]> {
  const rows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics
        WHERE group_id = ${groupId}`;
    }),
  );
  return [...rows];
}

async function groupTopicRows(db: ServerDatabase, groupId: string): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  return [...rows];
}

// Re-apply the desired members to every topic room, archived ones included
// (a removed person must not keep an affiliation). Public topics gain/lose
// the person; private ones drop anyone whose `topic_members` row is gone.
// Best effort: the database is the source of truth, and a failed room call
// is logged with the group id, never thrown.
export async function syncGroupTopicRooms(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  groupId: string,
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  const rows = await groupTopicRows(db, groupId);
  let failed = false;
  for (const topic of rows) {
    try {
      await syncTopicRoom({ db, adminClient, domain, logger }, topic);
    } catch {
      failed = true;
      logger.warn({ groupId }, 'could not sync a topic room after a group membership change');
    }
  }
  if (failed) {
    notePendingGroupSync(groupId, { db, adminClient, domain, logger });
  }
}

// After a membership change, an AI the derived rule (`aiMayBeInTopic`) no
// longer allows gets an `ai-removed` event, so a live session leaves at
// once. The `topic_ais` rows stay: re-adding the owner brings the AI back.
export async function emitDroppedGroupTopicAis(db: ServerDatabase, groupId: string): Promise<void> {
  const topicRows = await groupTopicRows(db, groupId);
  for (const topic of topicRows) {
    // Every non-General topic follows the derived rule, so a dropped AI is
    // announced for public topics too.
    if (topic.isGeneral || topic.archivedAt !== null) {
      continue;
    }
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string; owner: string; status: string }>`SELECT topic_ais.ai_id,
          ais.owner, ais.status FROM topic_ais
          INNER JOIN ais ON ais.id = topic_ais.ai_id
          WHERE topic_ais.topic_id = ${topic.id}`;
      }),
    );
    for (const row of aiRows) {
      const allowed = await aiMayBeInTopic(db, topic, {
        id: row.aiId,
        owner: row.owner,
        status: row.status,
      });
      if (!allowed) {
        emitTopicAi({ type: 'ai-removed', topicId: topic.id, aiId: row.aiId });
      }
    }
  }
}

// A private topic with no members left is archived; role holders count as
// members, so a topic a role still grants stays alive.
export async function archiveDrainedPrivateTopics(
  db: ServerDatabase,
  groupId: string,
): Promise<void> {
  const rows = await groupTopicRows(db, groupId);
  for (const topic of rows) {
    if (topic.archivedAt !== null || topic.visibility !== 'private' || topic.isGeneral) {
      continue;
    }
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM topic_members
          WHERE topic_id = ${topic.id}`;
      }),
    );
    if (Number(row?.total ?? 0) !== 0) {
      continue;
    }
    const holders = await topicRoleHolderIds(db, topic.id, groupId);
    if (holders.size === 0) {
      const now = new Date();
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`UPDATE topics SET archived_at = ${now}, updated_at = ${now}
            WHERE id = ${topic.id}`;
        }),
      );
    }
  }
}

// People and AIs share one cap; every path that can exceed it answers this same 400.
export function groupLimitError(): HttpError {
  return new HttpError(400, 'invalid_request', `A group has at most ${MAX_GROUP_MEMBERS} members`);
}

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
    throw groupLimitError();
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
              return yield* Effect.fail(groupLimitError());
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
