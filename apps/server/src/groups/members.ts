import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { dropMemberRoles } from '../roles/service';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import {
  archiveDrainedPrivateTopics,
  emitDroppedGroupTopicAis,
  groupLimitError,
  removeGroupAi,
  syncGroupTopicRooms,
} from './ais';
import { banMember, unbanMembers } from './bans';
import { assertContacts, inviteNewMembers } from './invites';
import { assertChannelKeepsAnAdmin, getGroupDetail, getMembership, requireGroup } from './queries';
import {
  MAX_GROUP_MEMBERS,
  mapXmppError,
  type AddGroupMembersInput,
  type GroupDetail,
  type GroupRole,
  type RemoveGroupMemberInput,
} from './schemas';

export async function addGroupMembers(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: AddGroupMembersInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!actor) {
    throw new HttpError(403, 'forbidden', 'Not a member of this group');
  }
  if (actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can add members');
  }

  const targets = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  await assertContacts(db, input.actorId, targets);

  const existing = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${input.groupId}`;
    }),
  );
  const existingIds = new Set(existing.map((row) => row.userId));
  const toAdd = targets.filter((id) => !existingIds.has(id));

  if (toAdd.length > 0) {
    // People and AIs share the same cap.
    const aiRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ aiId: string }>`SELECT ai_id FROM group_ais
          WHERE group_id = ${input.groupId}`;
      }),
    );
    if (existingIds.size + aiRows.length + toAdd.length > MAX_GROUP_MEMBERS) {
      throw groupLimitError();
    }
    let added: string[] = toAdd;
    try {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-join:' + input.groupId}))`;
              const current = yield* sql<{ userId: string }>`SELECT user_id FROM group_members
                WHERE group_id = ${input.groupId}`;
              const currentIds = new Set(current.map((row) => row.userId));
              added = toAdd.filter((id) => !currentIds.has(id));
              if (added.length === 0) {
                return;
              }
              const [aiCount] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
                FROM group_ais WHERE group_id = ${input.groupId}`;
              if (
                currentIds.size + Number(aiCount?.total ?? 0) + added.length >
                MAX_GROUP_MEMBERS
              ) {
                return yield* Effect.fail(groupLimitError());
              }
              for (const userId of added) {
                yield* Effect.tryPromise({
                  try: () =>
                    adminClient.setAffiliation(
                      group.roomLocalpart,
                      jidFor(localpartFor(userId), input.domain),
                      'member',
                    ),
                  catch: (error) => error,
                });
              }
              // Adding someone back lifts the ban a removal set, in the same transaction.
              yield* unbanMembers(sql, input.groupId, added);
              yield* sql`INSERT INTO group_members ${sql.insert(
                added.map((userId) => ({
                  group_id: input.groupId,
                  user_id: userId,
                  role: 'member',
                })),
              )}`;
            }),
          );
        }),
      );
    } catch (error) {
      throw mapXmppError(error);
    }
    await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
  }

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while adding members');
  }
  await inviteNewMembers(adminClient, group.roomLocalpart, toAdd, input.domain, input.logger);
  return detail;
}

export async function removeGroupMember(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: RemoveGroupMemberInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!actor) {
    throw new HttpError(403, 'forbidden', 'Not a member of this group');
  }
  const target = await getMembership(db, input.groupId, input.targetUserId);
  if (!target) {
    throw new HttpError(404, 'not_found', 'That user is not a member of this group');
  }

  const isSelf = input.actorId === input.targetUserId;
  if (!isSelf && actor.role === 'member') {
    throw new HttpError(403, 'forbidden', 'Only owners and admins can remove members');
  }
  if (target.role === 'owner') {
    throw new HttpError(403, 'forbidden', 'The owner cannot be removed');
  }
  if (group.kind === 'channel' && !isSelf && target.role === 'admin') {
    await assertChannelKeepsAnAdmin(db, input.groupId, input.targetUserId);
  }

  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            // Take the same per-group lock as hand-over and re-read both roles under it;
            // the pre-checks are fast answers, these reads are the authority.
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-owner:' + input.groupId}))`;
            const [lockedActor] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
            if (!lockedActor) {
              return yield* Effect.fail(
                new HttpError(403, 'forbidden', 'Not a member of this group'),
              );
            }
            const [lockedTarget] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId} LIMIT 1`;
            if (!lockedTarget) {
              return yield* Effect.fail(
                new HttpError(404, 'not_found', 'That user is not a member of this group'),
              );
            }
            if (!isSelf && lockedActor.role === 'member') {
              return yield* Effect.fail(
                new HttpError(403, 'forbidden', 'Only owners and admins can remove members'),
              );
            }
            if (lockedTarget.role === 'owner') {
              return yield* Effect.fail(
                new HttpError(403, 'forbidden', 'The owner cannot be removed'),
              );
            }
            yield* Effect.tryPromise({
              try: () =>
                adminClient.setAffiliation(
                  group.roomLocalpart,
                  jidFor(localpartFor(input.targetUserId), input.domain),
                  'none',
                ),
              catch: (error) => error,
            });
            // `role <> 'owner'` refuses at the write: even a slipped-in hand-over cannot
            // delete the owner's row.
            yield* sql`DELETE FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId}
                AND role <> 'owner'`;
            // A removal by an owner/admin bans the person, so public joins and invites
            // refuse them; a self-leave never bans. Same transaction, no half state.
            if (!isSelf) {
              yield* banMember(sql, input.groupId, input.targetUserId, input.actorId);
            }
            const topicRows = yield* sql<{ id: string }>`SELECT id FROM topics
              WHERE group_id = ${input.groupId}`;
            const topicIds = topicRows.map((row) => row.id);
            if (topicIds.length > 0) {
              yield* sql`DELETE FROM topic_members
                WHERE topic_id IN ${sql.in(topicIds)} AND user_id = ${input.targetUserId}`;
            }
          }),
        );
      }),
    );
  } catch (error) {
    throw mapXmppError(error);
  }
  // A removed member takes their AIs with them: `removeGroupAi` accepts the
  // owner as actor after they left. Best effort per AI, logged with ids only.
  const ownedAis = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ga.ai_id AS ai_id FROM group_ais ga
        INNER JOIN "ais" ON "ais".id = ga.ai_id
        WHERE ga.group_id = ${input.groupId} AND "ais".owner = ${input.targetUserId}`;
    }),
  );
  for (const { aiId } of ownedAis) {
    try {
      await removeGroupAi(db, adminClient, {
        groupId: input.groupId,
        actorId: input.targetUserId,
        aiId,
        domain: input.domain,
        logger: input.logger,
      });
    } catch (error) {
      input.logger.warn(
        { err: error, groupId: input.groupId, aiId },
        'could not remove a departed member AI',
      );
    }
  }
  const droppedRoleIds = await dropMemberRoles(
    {
      db,
      adminClient,
      domain: input.domain,
      logger: input.logger,
    },
    input.groupId,
    input.targetUserId,
  );
  for (const roleId of droppedRoleIds) {
    try {
      await recordAudit(
        db,
        {
          actorUserId: input.actorId,
          aiId: null,
          groupId: input.groupId,
          action: 'group.role_unassigned',
          subjectId: roleId,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: { groupId: input.groupId, subjectUserId: input.targetUserId },
        },
        new Date(),
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not audit a role loss on leave');
    }
  }
  // Public topics lose the person; private ones drop them when their row is
  // gone. Best effort, logged with the group id. Also drops AIs whose owner
  // lost visibility, and tells live sessions to leave those rooms.
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
  await emitDroppedGroupTopicAis(db, input.groupId);
  await archiveDrainedPrivateTopics(db, input.groupId);

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing a member');
  }
  return detail;
}
