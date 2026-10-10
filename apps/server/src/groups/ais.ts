import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { findOwnedAi } from '../ais/service';
import { deleteRoomMemoryEffect } from '../agents/memory/store';
import { revokeActiveRulesForAiInGroupEffect } from '../approvals/rules';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { deleteRoutinesForAiInGroupEffect } from '../routines/service';
import { topicRoleHolderIds } from '../roles/service';
import { deleteToolsForAiInGroupEffect } from '../tools/service';
import { aiMayBeInTopic, type TopicRow } from '../topics/access';
import { syncTopicRoom } from '../topics/rooms';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { emitGroupAi, emitTopicAi } from './events';
import { getGroupDetail, getMembership, requireGroup } from './queries';
import {
  MAX_GROUP_MEMBERS,
  mapXmppError,
  type AddGroupAiInput,
  type GroupDetail,
  type InviteLogger,
  type RemoveGroupAiInput,
} from './schemas';

// Adds an AI to a group: the actor must own or administer the group and own
// the AI (a foreign AI answers the same 404 as a missing one, so AI ids
// cannot be probed). Adding an AI that is already there is a no-op returning
// the detail. People and AIs share MAX_GROUP_MEMBERS.
// T-0124: in a channel the AI joins with the admin-owned-AI voice rule
// (`applyChannelAiVoice` outcome: affiliation `admin` while its owner is a
// channel owner/admin, else `member`), so an admin-owned AI can post from
// the moment it is added instead of waiting for an unrelated re-sync.
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
  // A stopped (kill switch) or still-provisioning AI cannot join a room: it
  // would not answer, and a stale membership would surprise the room. An AI
  // that is already a member is left alone by the branch above.
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
            yield* Effect.tryPromise({
              try: () => adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'member'),
              catch: (error) => error,
            });
            // Two concurrent adds both pass the check above: the loser lands here
            // and still answers 200, keeping the add idempotent.
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
  // T-0124: a fresh AI row in a channel feed must carry the voice rule at
  // once (the transaction above always writes `member`, which is voiceless
  // for everyone in a channel). `syncChannelVoice` covers people only, so
  // the feed room re-syncs here: an admin-owned AI is lifted to `admin`,
  // anything else stays `member`. Best effort after the commit, like the
  // member flows — a failure is logged, never thrown, and the next sync
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

// Removes an AI from a group: allowed for the AI's owner, or a group owner or
// admin. The AI owner need not still be a group member.
export async function removeGroupAi(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: RemoveGroupAiInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  // Authorize before looking at the group's AIs, so someone who may not
  // remove the AI can't learn whether it is in the group (404 vs 403).
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
            // T-0109: removing the AI from the group removes it from every topic
            // of that group. The rows are deleted in the same transaction as the
            // rules/tools cleanup below; every non-General topic room is re-synced
            // after the commit (the gateway leaves through the same event).
            const topicRows = yield* sql<{ id: string; roomLocalpart: string }>`SELECT id,
              room_localpart FROM topics WHERE group_id = ${input.groupId}`;
            const topicIds = topicRows.map((row) => row.id);
            if (topicIds.length > 0) {
              yield* sql`DELETE FROM topic_ais
                WHERE topic_id IN ${sql.in(topicIds)} AND ai_id = ${input.aiId}`;
            }
            // T-0099: an "always" rule tied to this (AI, group) pair must
            // die with the membership. Personal rules and other-group rules
            // are unaffected. `now` is the same timestamp the admin client
            // saw for the affiliation change so audit rows line up.
            yield* revokeActiveRulesForAiInGroupEffect({
              aiId: input.aiId,
              groupId: input.groupId,
              actorId: input.actorId,
              now: new Date(),
            });
            // T-0103: the AI's tools made in this group die with the
            // membership, like the rules above. Personal-chat tools and
            // other-group tools are unaffected.
            yield* deleteToolsForAiInGroupEffect({
              aiId: input.aiId,
              groupId: input.groupId,
              now: new Date(),
            });
            // T-0104: the AI's routines in this group die with the membership
            // too, next to the tools above.
            yield* deleteRoutinesForAiInGroupEffect({
              aiId: input.aiId,
              groupId: input.groupId,
              now: new Date(),
            });
            // T-0442: the AI's memory of the group room and every topic room dies
            // with the membership, in the same transaction (plan §3.5). Its DM
            // memory and rows of other AIs are unaffected.
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

  // Every topic room of the group where the AI had a row loses it. Best
  // effort after the commit, like the member flows: a failure is logged with
  // the group id (never a topic name), never thrown.
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
  emitGroupAi({ type: 'ai-removed', groupId: input.groupId, aiId: input.aiId });
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing an AI');
  }
  return detail;
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

// T-0108: re-apply the desired members to every active topic room of the
// group (public topics gain/lose the person; private topics drop anyone
// whose `topic_members` row is gone). Best effort: the database is the
// source of truth, and a failed room call is logged with the group id
// (never a topic name), never thrown, so the group flow that just committed
// is not rolled back by a room hiccup.
export async function syncGroupTopicRooms(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  groupId: string,
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  const rows = await groupTopicRows(db, groupId);
  for (const topic of rows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    try {
      await syncTopicRoom({ db, adminClient, domain, logger }, topic);
    } catch {
      logger.warn({ groupId }, 'could not sync a topic room after a group membership change');
    }
  }
}

// T-0109: after a group membership change, every AI that the derived rule
// (`aiMayBeInTopic`) no longer allows in a topic gets an `ai-removed` event
// so a live gateway session leaves the room without waiting for reconcile.
// The `topic_ais` rows stay: re-adding the owner brings the AI back.
export async function emitDroppedGroupTopicAis(db: ServerDatabase, groupId: string): Promise<void> {
  const topicRows = await groupTopicRows(db, groupId);
  for (const topic of topicRows) {
    if (topic.isGeneral || topic.archivedAt !== null || topic.visibility !== 'private') {
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

// T-0108: a private topic with no members left is archived. T-0116: role
// holders count as members — a topic a role still grants access to stays
// alive even with zero direct rows.
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
