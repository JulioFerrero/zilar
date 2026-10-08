// Open join for public groups and channels (T-0164): any signed-in user
// may join with one request, no invite. The membership write reuses the
// invite-link join pieces (the XMPP room affiliation, the topic sync and
// the audit entry all happen) without duplicating the XMPP logic.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import type { groups } from '../db/schema';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { syncPublicTopicsByLink, type InviteLinkServiceDeps } from '../invite-links/service';
import type { InviteLogger } from './service';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { PUBLIC_GROUP_MAX_MEMBERS } from '../directory/service';

type GroupRow = typeof groups.$inferSelect;

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

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported function stays `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  deps: JoinPublicGroupDeps,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(deps.db).runPromise(effect);
}

// Unknown and private groups answer the same 404, so group ids cannot be
// probed from here. A user already in the group gets the same answer as a
// success (idempotent). Beyond the cap (people and AIs share it — one
// rule, counted by `countOccupants` in the pre-check and in the
// transaction alike) the join answers 409 `group_full`. The transaction
// takes a per-group advisory lock BEFORE counting, so concurrent joins
// serialize on the group and never exceed the cap (the unique index is
// still the backstop for the same-user race, which answers `alreadyMember`).
// A room failure after the commit is best effort (logged, never thrown),
// like the other member flows; a room failure inside the transaction
// answers 503 with nothing committed.
export async function joinPublicGroup(
  deps: JoinPublicGroupDeps,
  groupId: string,
  userId: string,
): Promise<JoinPublicGroupResult> {
  const maxMembers = deps.maxMembers ?? PUBLIC_GROUP_MAX_MEMBERS;
  const [group] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  // Private and unknown read the same: no oracle for strangers.
  if (!group || group.visibility !== 'public') {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const [existing] = await runSql(
    deps,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  if (existing) {
    return { groupId, alreadyMember: true };
  }
  // The pre-transaction refusal, so a full group answers 409 before any
  // write, like the link flow; the locked count inside the transaction is
  // the authority.
  if ((await runSql(deps, countOccupants(groupId))) + 1 > maxMembers) {
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
    deps,
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
          // Locked above: the count and the insert are atomic against concurrent
          // joins of this group, so the cap is never exceeded (people and AIs
          // share it, same as the pre-check).
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
            catch: (error) =>
              error instanceof HttpError
                ? error
                : new HttpError(
                    503,
                    'xmpp_unavailable',
                    'The chat service is temporarily unavailable',
                  ),
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
  await syncPublicTopicsByLink(linkDeps, groupId);
  try {
    await deps.adminClient.sendDirectInvitation(group.roomLocalpart, [
      jidFor(localpartFor(userId), deps.domain),
    ]);
  } catch (error) {
    deps.logger.warn(
      { err: error, roomLocalpart: group.roomLocalpart, members: 1 },
      'could not send the group invitations',
    );
  }
  if (deps.audit) {
    await deps.audit.record({
      actorUserId: userId,
      aiId: null,
      groupId,
      action: 'group.joined_public',
      subjectId: groupId,
      argsHash: null,
      costCurrency: null,
      costAmount: null,
      result: 'ok',
      detail: { groupId },
    });
  }
  return { groupId, alreadyMember: false };
}

// The one cap rule, used by the pre-check and the transaction alike:
// people plus AIs share the seats. The transaction reads it under the
// per-group advisory lock, so it is the atomic authority; the pre-check
// outside only refuses early. Yielding `SqlClient` inside resolves it to
// the transaction connection when called in a transaction and to the plain
// runtime outside one.
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
