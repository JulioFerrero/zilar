// Hand a group or channel to another member: the roles swap in one
// transaction (target `owner`, actor `admin`), then the rooms re-sync. The
// old owner can then leave like any admin.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { recordAudit, type AuditRecorder } from '../audit/recorder';
import type { EjabberdAdminClient } from '../xmpp/admin/types';
import type { RoomAffiliation } from '../xmpp/admin/schemas';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { roomAffiliationFor } from '../topics/room-members';
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

// Only the owner may transfer (403); the target must be a member (404);
// transferring to themselves is 400. Both rows are written under a per-group
// advisory lock, so two transfers cannot leave two owners.
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

  // The rows are committed; the rooms follow best effort, logged with the
  // group id. `syncChannelVoice` re-applies the channel mapping and
  // `syncGroupTopicRooms` re-syncs every topic, so a failure heals.
  const isChannelFeed = group.kind === 'channel';
  const affiliations: Array<{ userId: string; affiliation: RoomAffiliation }> = [
    {
      userId: input.targetUserId,
      affiliation: roomAffiliationFor('owner', isChannelFeed),
    },
    {
      userId: input.actorId,
      affiliation: roomAffiliationFor('admin', isChannelFeed),
    },
  ];
  for (const { userId, affiliation } of affiliations) {
    try {
      await adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(userId), input.domain),
        affiliation,
      );
    } catch {
      input.logger.warn({ groupId: input.groupId }, 'could not set a transfer affiliation');
    }
  }
  await syncChannelVoice(db, adminClient, input.groupId, input.domain, input.logger);
  await syncGroupTopicRooms(db, adminClient, input.groupId, input.domain, input.logger);

  // Audited as `group.role_changed` (ids and roles only, never names); a failed
  // audit write never fails the request.
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
