import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { ServerDatabase } from '../db/client';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { roomAffiliationFor } from '../topics/room-members';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { assertChannelKeepsAnAdmin, getGroupDetail, getMembership, requireGroup } from './queries';
import {
  mapXmppError,
  type ChangeMemberRoleInput,
  type GroupDetail,
  type GroupRole,
  type InviteLogger,
} from './schemas';

// Owner only. Groups and channels share this route, and a group admin gets
// the same approval powers as a channel admin. The row commits first and the
// room affiliation follows best effort. In a channel's moderated room an
// admin gains voice and a demoted admin loses it; in a plain group the person
// is `member` either way. Demoting the last channel admin is refused
// (`channel_needs_admin`), so the feed cannot fall silent.
export async function changeMemberRole(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: ChangeMemberRoleInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);
  const actor = await getMembership(db, input.groupId, input.actorId);
  if (!group || !actor || actor.role !== 'owner') {
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
  // The update runs under the same per-group lock as hand-over and re-reads
  // both roles inside it, so a change cannot race a transfer into an ownerless
  // group.
  let previousRole: GroupRole = target.role;
  try {
    await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-owner:' + input.groupId}))`;
            const [lockedActor] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
            if (lockedActor?.role !== 'owner') {
              return yield* Effect.fail(new HttpError(404, 'not_found', 'Group not found'));
            }
            const [lockedTarget] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
              WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId} LIMIT 1`;
            if (!lockedTarget) {
              return yield* Effect.fail(
                new HttpError(404, 'not_found', 'That user is not a member of this group'),
              );
            }
            if (lockedTarget.role === 'owner') {
              return yield* Effect.fail(
                new HttpError(403, 'forbidden', 'The owner cannot be demoted'),
              );
            }
            previousRole = lockedTarget.role;
            if (lockedTarget.role === input.role) {
              return;
            }
            yield* sql`UPDATE group_members SET role = ${input.role}
              WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId}
                AND role <> 'owner'`;
          }),
        );
      }),
    );
  } catch (error) {
    throw mapXmppError(error);
  }
  try {
    await adminClient.setAffiliation(
      group.roomLocalpart,
      jidFor(localpartFor(input.targetUserId), input.domain),
      roomAffiliationFor(input.role, group.kind === 'channel'),
    );
  } catch {
    input.logger.warn({ groupId: input.groupId }, 'could not set the member role affiliation');
    await syncChannelVoice(db, adminClient, input.groupId, input.domain, input.logger);
  }
  // Audited as `group.role_changed` (ids and roles only, never names); a failed
  // audit write never fails the request.
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
            from: previousRole,
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

// Re-applies a channel room's voice mapping: owners/admins `admin`,
// subscribers `member`; a group room is untouched. Best effort, logged with
// the group id.
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
    try {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(row.userId), domain),
        roomAffiliationFor(row.role, true),
      );
    } catch {
      logger.warn({ groupId }, 'could not sync the channel voice');
    }
  }
}
