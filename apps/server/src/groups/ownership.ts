// SG-4 / T-1187: hand a group or channel over to another member. The owner
// swaps their role with the target in one transaction (the target becomes
// `owner`, the actor becomes `admin`), then the General room affiliation
// follows outside the transaction and the channel voice and topic rooms
// re-sync. The old owner can then leave like any admin. Deleting a group is a
// later task.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit, type AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { syncGroupTopicRooms } from './ais';
import { syncChannelVoice } from './member-roles';
import { getGroupDetail, requireGroup } from './queries';
import type { GroupDetail, GroupRole, InviteLogger } from './schemas';

export interface TransferGroupOwnerInput {
  groupId: string;
  actorId: string;
  targetUserId: string;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

// The owner hands the group to another member. Only the owner may transfer
// (403); the target must be a member (404); the owner transferring to
// themselves is a 400. Both role rows are written in one transaction under a
// per-group advisory lock, so two concurrent transfers cannot leave the group
// with two owners.
export async function transferGroupOwner(
  db: ServerDatabase,
  adminClient: EjabberdAdminClient,
  input: TransferGroupOwnerInput,
): Promise<GroupDetail> {
  const group = await requireGroup(db, input.groupId);

  const targetRole = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-owner:' + input.groupId}))`;
          const [actor] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
            WHERE group_id = ${input.groupId} AND user_id = ${input.actorId} LIMIT 1`;
          if (actor?.role !== 'owner') {
            return yield* Effect.fail(
              new HttpError(403, 'forbidden', 'Only the owner can hand the group over'),
            );
          }
          const [target] = yield* sql<{ role: GroupRole }>`SELECT role FROM group_members
            WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId} LIMIT 1`;
          if (!target) {
            return yield* Effect.fail(
              new HttpError(404, 'not_found', 'That user is not a member of this group'),
            );
          }
          if (input.targetUserId === input.actorId) {
            return yield* Effect.fail(
              new HttpError(400, 'invalid_request', 'You already own this group'),
            );
          }
          yield* sql`UPDATE group_members SET role = 'owner'
            WHERE group_id = ${input.groupId} AND user_id = ${input.targetUserId}`;
          yield* sql`UPDATE group_members SET role = 'admin'
            WHERE group_id = ${input.groupId} AND user_id = ${input.actorId}`;
          return target.role;
        }),
      );
    }),
  );

  // The rows are committed: the rooms follow best-effort, like every other
  // membership change. `members.ts` sets the General room affiliation through
  // `adminClient.setAffiliation(group.roomLocalpart, jidFor(localpartFor(userId), domain), role)`;
  // a failure is logged with the group id, never thrown, so the committed rows
  // stay. `syncChannelVoice` re-applies the channel mapping (a group room is
  // left untouched) and `syncGroupTopicRooms` re-syncs every topic room
  // (T-1180 retries a failed sync).
  const affiliations: Array<{ userId: string; role: 'owner' | 'admin' }> = [
    { userId: input.targetUserId, role: 'owner' },
    { userId: input.actorId, role: 'admin' },
  ];
  for (const { userId, role } of affiliations) {
    try {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(userId), input.domain),
        role,
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not set a transfer affiliation');
    }
  }
  await syncChannelVoice(db, adminClient, input.groupId, input.domain, input.logger);
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);

  // T-0124: every role change is audited as `group.role_changed` (ids and roles
  // only, never names). The transfer changes two rows, so both are recorded.
  // A recorder is injected by the route; a write failure is logged and never
  // fails the request.
  if (input.audit) {
    const changes: Array<{ userId: string; from: GroupRole; to: 'owner' | 'admin' }> = [
      { userId: input.targetUserId, from: targetRole, to: 'owner' },
      { userId: input.actorId, from: 'owner', to: 'admin' },
    ];
    for (const change of changes) {
      try {
        await recordAudit(
          db,
          {
            actorUserId: input.actorId,
            aiId: null,
            groupId: input.groupId,
            action: 'group.role_changed',
            subjectId: change.userId,
            argsHash: null,
            costCurrency: null,
            costAmount: null,
            result: 'ok',
            detail: {
              groupId: input.groupId,
              subjectUserId: change.userId,
              from: change.from,
              to: change.to,
            },
          },
          new Date(),
        );
      } catch {
        input.logger.warn({ groupId: input.groupId }, 'could not audit a role change');
      }
    }
  }

  const detail = await getGroupDetail(db, input.groupId);
  if (!detail) {
    throw new Error('group disappeared while handing it over');
  }
  return detail;
}
