import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { dropMemberRoles } from '../roles/service';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { archiveDrainedPrivateTopics, emitDroppedGroupTopicAis, syncGroupTopicRooms } from './ais';
import { assertContacts, inviteNewMembers } from './invites';
import { assertChannelKeepsAnAdmin, getGroupDetail, getMembership, requireGroup } from './queries';
import {
  MAX_GROUP_MEMBERS,
  mapXmppError,
  type AddGroupMembersInput,
  type ChangeMemberRoleInput,
  type GroupDetail,
  type GroupRole,
  type InviteLogger,
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
    // T-0108: public topics gain the new members. The sync is best effort —
    // the members are in the database even if a room call fails (the failure
    // is logged with the group id, never a topic name).
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
            // T-0108: a removed person loses their private-topic rows too. The
            // topic room sync below then drops them from every topic room.
            const topicRows = yield* sql<{ id: string }>`SELECT id FROM topics
              WHERE group_id = ${input.groupId}`;
            const privateIds = topicRows.map((row) => row.id);
            if (privateIds.length > 0) {
              yield* sql`DELETE FROM topic_members
                WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${input.targetUserId}`;
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

// Promotes a member to admin (or demotes an admin back to member). Only the
// owner may change roles. The database row commits first; the room
// affiliation follows outside the transaction (best effort + log, like
// `addGroupMembers`): a room failure never rolls back the committed row,
// and the caller reconciles with `syncChannelVoice` so the affiliation
// heals on the next write. In a channel's moderated room an admin gains
// voice (affiliation `admin`) and a demoted admin loses it (`member`
// again), so the posting rule is enforced by the room, not by the UI.
// Demoting the channel's last admin is refused (`channel_needs_admin`), so
// the feed can never fall silent.
export async function changeMemberRole(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: ChangeMemberRoleInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  // A non-member sees the same 404 as a missing group (like every other
  // group route). A plain member sees it too: 403 here would tell them the
  // group exists and they are in it, an oracle strangers don't get.
  if (!group || !actor || actor.role !== 'owner') {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  // T-0124: channels only. Plain groups answer the same 404 as an unknown
  // group — the spec asks for channel rules only, and no group UI calls
  // this route.
  if (group.kind !== 'channel') {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const target = await getMembership(db, input.groupId, input.targetUserId);
  if (!target) {
    throw new HttpError(404, 'not_found', 'That user is not a member of this group');
  }
  if (target.role === 'owner') {
    throw new HttpError(403, 'forbidden', 'The owner cannot be demoted');
  }
  if (input.targetUserId === input.actorId) {
    throw new HttpError(403, 'forbidden', 'The owner cannot change their own role');
  }
  if (target.role === input.role) {
    const detail = await getGroupDetail(db, input.groupId);
    if (!detail) {
      throw new Error('group disappeared while changing a member role');
    }
    return detail;
  }
  if (input.role === 'member' && group.kind === 'channel') {
    await assertChannelKeepsAnAdmin(db, input.groupId, input.targetUserId);
  }
  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          sql`UPDATE group_members SET role = ${input.role}
            WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId}`,
        );
      }),
    );
  } catch (error) {
    throw mapXmppError(error);
  }
  // The row is committed: the room follows best-effort. A failure is logged
  // and the full voice mapping reconciles, so a half-applied change (row
  // committed, affiliation stale) heals instead of diverging permanently.
  try {
    await adminClient.setAffiliation(
      group.roomLocalpart,
      jidFor(localpartFor(input.targetUserId), input.domain),
      input.role,
    );
  } catch {
    input.logger.warn({ groupId: input.groupId }, 'could not set the member role affiliation');
    await syncChannelVoice(db, adminClient, input.groupId, input.domain, input.logger);
  }
  // T-0124: every promote/demote is audited as `group.role_changed` (ids and
  // roles only — never names). The recorder is injected by the route; a write
  // failure is logged and never fails the request.
  if (input.audit) {
    try {
      await recordAudit(
        db,
        {
          actorUserId: input.actorId,
          aiId: null,
          groupId: input.groupId,
          action: 'group.role_changed',
          subjectId: input.targetUserId,
          argsHash: null,
          costCurrency: null,
          costAmount: null,
          result: 'ok',
          detail: {
            groupId: input.groupId,
            subjectUserId: input.targetUserId,
            from: target.role,
            to: input.role,
          },
        },
        new Date(),
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not audit a role change');
    }
  }
  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while changing a member role');
  }
  return detail;
}

// After a role change or a drifted room, this re-applies the voice mapping
// of a channel room: every owner/admin holds affiliation admin/owner, every
// subscriber `member`. A group room is left untouched. Best effort: failures
// are logged with the group id (never member names) and never thrown. The
// role-change path calls this when its own affiliation write fails, so a
// committed row with a stale affiliation heals instead of diverging.
export async function syncChannelVoice(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  groupId: string,
  domain: string,
  logger: InviteLogger,
): Promise<void> {
  const [group] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (!group || group.kind !== 'channel') {
    return;
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string; role: GroupRole }>`SELECT user_id, role
        FROM group_members WHERE group_id = ${groupId}`;
    }),
  );
  for (const row of rows) {
    const wanted: 'owner' | 'admin' | 'member' =
      row.role === 'owner' ? 'owner' : row.role === 'admin' ? 'admin' : 'member';
    try {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(row.userId), domain),
        wanted,
      );
    } catch {
      logger.warn({ groupId }, 'could not sync the channel voice');
    }
  }
}
