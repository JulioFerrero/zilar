import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { dropMemberRoles } from '../roles/service';
import { addToPublicTopics } from '../topics/public-compat';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { archiveDrainedPrivateTopics, emitDroppedGroupTopicAis, syncGroupTopicRooms } from './ais';
import { assertContacts, inviteNewMembers } from './invites';
import { assertChannelKeepsAnAdmin, getGroupDetail, getMembership, requireGroup } from './queries';
import {
  MAX_GROUP_MEMBERS,
  mapXmppError,
  type AddGroupMembersInput,
  type GroupDetail,
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
      throw new HttpError(
        400,
        'invalid_request',
        `A group has at most ${MAX_GROUP_MEMBERS} members`,
      );
    }
    try {
      await runSql(
        db,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.withTransaction(
            Effect.gen(function* () {
              for (const userId of toAdd) {
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
              yield* sql`INSERT INTO group_members ${sql.insert(
                toAdd.map((userId) => ({
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
    // T-0108/T-1762: public topics gain the new members before the sync, so
    // the rooms see them. The membership is already committed, so this write
    // and the sync below are best effort: a failure is logged (ids only, never
    // a topic name) and never thrown. Throwing here would fail the request
    // while the members are already in the group, and every retry stops at the
    // `toAdd` filter above, so the topic rows would never be written.
    try {
      await addToPublicTopics(db, input.groupId, toAdd);
    } catch (error) {
      input.logger.warn(
        { err: error, groupId: input.groupId, userIds: toAdd },
        'could not add the new members to the public topics',
      );
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
  // T-0124: a channel always keeps its admins' voice (the room is moderated,
  // so only affiliation admin/owner may post). Removing the last admin is
  // refused here (demoting one is refused in `changeMemberRole`). The guard
  // fires only when the target is an admin: kicking a subscriber never takes
  // voice away, even in a channel that has no admins yet.
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
            yield* Effect.tryPromise({
              try: () =>
                adminClient.setAffiliation(
                  group.roomLocalpart,
                  jidFor(localpartFor(input.targetUserId), input.domain),
                  'none',
                ),
              catch: (error) => error,
            });
            yield* sql`DELETE FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId}`;
            // T-0108: a removed person loses their `topic_members` rows for
            // every topic of the group. The topic room sync below then drops
            // them from every topic room.
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
  // T-0116: leaving the group drops the member's role rows, and the topics
  // they reached only through a role re-sync. Best effort after the commit,
  // like the room syncs above. The dropped rows are audited as
  // `group.role_unassigned` (ids only) so the log keeps who-held-what;
  // a failed audit write is logged and never thrown. The audit rows for a
  // private topic never carry its name either.
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
  // T-0108: public topics lose the person; private topics drop them when
  // their row is gone. Best effort after the database commit: a failure is
  // logged with the group id (never a topic name), never thrown. The sync
  // also drops AIs whose owner just lost visibility of a private topic
  // (derived rule in `topics/rooms.ts`); the event loop below tells live
  // gateway sessions to leave those rooms right away.
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);
  await emitDroppedGroupTopicAis(db, input.groupId);
  await archiveDrainedPrivateTopics(db, input.groupId);

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while removing a member');
  }
  return detail;
}
