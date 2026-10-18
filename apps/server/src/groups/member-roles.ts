import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { assertChannelKeepsAnAdmin, getGroupDetail, getMembership, requireGroup } from './queries';
import {
  mapXmppError,
  type ChangeMemberRoleInput,
  type GroupDetail,
  type GroupRole,
  type InviteLogger,
} from './schemas';

// Promotes a member to admin (or demotes an admin back to member). Only the
// owner may change roles. Plain groups and channels both use this route
// (T-1741): a group admin gets the same approval powers as a channel admin.
// The database row commits first; the room affiliation follows outside the
// transaction (best effort + log, like `addGroupMembers`): a room failure
// never rolls back the committed row, and the caller reconciles with
// `syncChannelVoice` so the affiliation heals on the next write. In a channel's
// moderated room an admin gains voice (affiliation `admin`) and a demoted admin
// loses it (`member` again), so the posting rule is enforced by the room, not
// by the UI. Demoting the channel's last admin is refused
// (`channel_needs_admin`), so the feed can never fall silent.
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
  // T-1990: the update runs under the same per-group lock as the hand-over and
  // re-reads both roles inside it, so a role change cannot race a transfer into
  // an ownerless group. `role <> 'owner'` is the same refusal at the write.
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
