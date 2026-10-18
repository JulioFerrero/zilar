import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import { pairHasBlock } from '../blocks/service';
import { isBanned, isBannedIn } from './bans';
import type { ServerDatabase } from '../db/client';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { syncPublicTopicsByLink, type InviteLinkServiceDeps } from '../invite-links/service';
import type { InviteLogger } from './service';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { PUBLIC_GROUP_MAX_MEMBERS } from '../directory/service';
import { addToPublicTopics } from '../topics/public-compat';
import { groupOwnerId } from './queries';

export interface JoinPublicGroupDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
  /** Test seam: the join cap. Defaults to `PUBLIC_GROUP_MAX_MEMBERS`. */
  maxMembers?: number;
}

export interface JoinPublicGroupResult {
  groupId: string;
  alreadyMember: boolean;
}

// Unknown and private groups answer the same 404, as does a block in either
// direction between joiner and owner (SG-8), so neither is an oracle. A join
// beyond the cap answers 409 `group_full`; the transaction takes a per-group
// advisory lock before counting so concurrent joins cannot exceed it, with
// the unique index as backstop. A room failure after the commit is best
// effort; inside the transaction it answers 503 with nothing committed.
export async function joinPublicGroup(
  deps: JoinPublicGroupDeps,
  groupId: string,
  userId: string,
): Promise<JoinPublicGroupResult> {
  const maxMembers = deps.maxMembers ?? PUBLIC_GROUP_MAX_MEMBERS;
  const [group] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (!group || group.visibility !== 'public') {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const ownerId = await groupOwnerId(deps.db, groupId);
  if (ownerId !== null && (await pairHasBlock(deps.db, userId, ownerId))) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  // A member removed by an owner/admin is banned, and a ban answers the same
  // 404.
  if (await isBanned(deps.db, groupId, userId)) {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const [existing] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  if (existing) {
    return { groupId, alreadyMember: true };
  }
  if ((await runSql(deps.db, countOccupants(groupId))) + 1 > maxMembers) {
    throw new HttpError(409, 'group_full', 'This group is full');
  }

  const linkDeps: InviteLinkServiceDeps = {
    db: deps.db,
    adminClient: deps.adminClient,
    domain: deps.domain,
    logger: deps.logger,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
  const joined = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'group-join:' + groupId}))`;
          const [inside] = yield* sql<{ userId: string }>`SELECT user_id FROM group_members
            WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
          if (inside) {
            return false;
          }
          if (yield* isBannedIn(sql, groupId, userId)) {
            return yield* Effect.fail(new HttpError(404, 'not_found', 'Group not found'));
          }
          // Locked above: count and insert are atomic against concurrent joins, so the
          // cap is never exceeded.
          if ((yield* countOccupants(groupId)) + 1 > maxMembers) {
            return yield* Effect.fail(new HttpError(409, 'group_full', 'This group is full'));
          }
          yield* Effect.tryPromise({
            try: () =>
              deps.adminClient.setAffiliation(
                group.roomLocalpart,
                jidFor(localpartFor(userId), deps.domain),
                'member',
              ),
            catch: (error) => (error instanceof HttpError ? error : xmppUnavailable()),
          });
          const inserted = yield* sql<{
            groupId: string;
          }>`INSERT INTO group_members (group_id, user_id, role)
            VALUES (${groupId}, ${userId}, 'member')
            ON CONFLICT (group_id, user_id) DO NOTHING
            RETURNING group_id`;
          return inserted.length > 0;
        }),
      );
    }),
  );
  if (!joined) {
    return { groupId, alreadyMember: true };
  }
  await finishJoin(linkDeps, {
    userId,
    groupId,
    roomLocalpart: group.roomLocalpart,
    action: 'group.joined_public',
    subjectId: groupId,
    detail: { groupId },
  });
  return { groupId, alreadyMember: false };
}

export async function finishJoin(
  deps: InviteLinkServiceDeps,
  input: {
    userId: string;
    groupId: string;
    roomLocalpart: string;
    action: string;
    subjectId: string;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await addToPublicTopics(deps.db, input.groupId, [input.userId]);
  } catch (error) {
    deps.logger.warn(
      { err: error, groupId: input.groupId, userIds: [input.userId] },
      'could not add the newcomer to the public topics',
    );
  }
  await syncPublicTopicsByLink(deps, input.groupId);
  try {
    await deps.adminClient.sendDirectInvitation(input.roomLocalpart, [
      jidFor(localpartFor(input.userId), deps.domain),
    ]);
  } catch (error) {
    deps.logger.warn(
      { err: error, roomLocalpart: input.roomLocalpart, members: 1 },
      'could not send the group invitations',
    );
  }
  await deps.audit?.record({
    actorUserId: input.userId,
    aiId: null,
    groupId: input.groupId,
    action: input.action,
    subjectId: input.subjectId,
    argsHash: null,
    costCurrency: null,
    costAmount: null,
    result: 'ok',
    detail: input.detail,
  });
}

// One cap rule for pre-check and transaction: people plus AIs share seats;
// the transaction reads it under the lock and is the authority.
function countOccupants(
  groupId: string,
): Effect.Effect<number, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [memberTotal] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
      FROM group_members WHERE group_id = ${groupId}`;
    const [aiTotal] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
      FROM group_ais WHERE group_id = ${groupId}`;
    return Number(memberTotal?.total ?? 0) + Number(aiTotal?.total ?? 0);
  });
}
