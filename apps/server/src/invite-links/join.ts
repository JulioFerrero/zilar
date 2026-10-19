import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import { pairHasBlock } from '../blocks/service';
import type { ServerDatabase } from '../db/client';
import type { GroupRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError, xmppUnavailable } from '../errors';
import { isBanned, isBannedIn } from '../groups/bans';
import { groupOwnerId } from '../groups/queries';
import { finishJoin } from '../groups/join';
import type { TopicRow } from '../topics/access';
import { syncTopicRoom } from '../topics/rooms';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { countGroupMembers, findLinkRow, isGroupMember, linkIsUsable, serviceNow } from './queries';
import { toInvalidLink, type InviteLinkServiceDeps, type JoinPreview } from './tokens';
import { MAX_GROUP_MEMBERS } from '../groups/schemas';

// The preview shows the group title and member count, never member names, and the group
// id only to a member. Unknown, expired, revoked and exhausted links all answer the same
// 404 `invalid_link`, so a failure never reveals why.
export async function previewInviteLink(
  deps: InviteLinkServiceDeps,
  token: string,
  userId: string,
): Promise<JoinPreview> {
  const row = await findLinkRow(deps.db, token);
  if (!row || !linkIsUsable(row, serviceNow(deps))) {
    throw toInvalidLink();
  }
  const [group] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ title: string; kind: 'group' | 'channel' }>`SELECT title, kind FROM groups
        WHERE id = ${row.groupId} LIMIT 1`;
    }),
  );
  if (!group) {
    throw toInvalidLink();
  }
  const [memberCount, alreadyMember] = await Promise.all([
    countGroupMembers(deps.db, row.groupId),
    isGroupMember(deps.db, row.groupId, userId),
  ]);
  return {
    groupTitle: group.title,
    memberCount,
    alreadyMember,
    ...(alreadyMember ? { groupId: row.groupId } : {}),
    kind: group.kind,
  };
}

export interface JoinByLinkResult {
  groupId: string;
  alreadyMember: boolean;
}

// The membership re-check, the claim and the insert share one transaction. A same-user
// racer consumes nothing; at most `max_uses` strangers win via the conditional claim; and
// a room failure rolls the claim back, so a 503 never burns a use either.
export async function joinByInviteLink(
  deps: InviteLinkServiceDeps,
  token: string,
  userId: string,
): Promise<JoinByLinkResult> {
  const now = serviceNow(deps);
  const link = await findLinkRow(deps.db, token);
  if (!link || !linkIsUsable(link, now)) {
    throw toInvalidLink();
  }
  const [group] = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRow>`SELECT * FROM groups WHERE id = ${link.groupId} LIMIT 1`;
    }),
  );
  if (!group) {
    throw toInvalidLink();
  }
  // A block in either direction refuses the join with the same 404 as an unusable link,
  // so a block is never an oracle.
  const ownerId = await groupOwnerId(deps.db, link.groupId);
  if (ownerId !== null && (await pairHasBlock(deps.db, userId, ownerId))) {
    throw toInvalidLink();
  }
  // A banned member is refused with the same 404, before any use is claimed.
  if (await isBanned(deps.db, link.groupId, userId)) {
    throw toInvalidLink();
  }
  if (await isGroupMember(deps.db, link.groupId, userId)) {
    return { groupId: link.groupId, alreadyMember: true };
  }
  await assertGroupHasRoom(deps.db, link.groupId);
  if (deps.beforeJoinTransaction !== undefined) {
    await deps.beforeJoinTransaction();
  }

  // A typed failure and a failing room call both abort the transaction, so the claim rolls
  // back and a failed join consumes nothing.
  const joined = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [existing] = yield* sql<{ userId: string }>`SELECT user_id FROM group_members
            WHERE group_id = ${link.groupId} AND user_id = ${userId} LIMIT 1`;
          if (existing !== undefined) {
            return false;
          }
          if (yield* isBannedIn(sql, link.groupId, userId)) {
            return yield* Effect.fail(toInvalidLink());
          }
          const claimed = yield* claimLinkUse(sql, link.id, now);
          if (!claimed) {
            return yield* Effect.fail(toInvalidLink());
          }
          // A room failure reaches the caller unchanged: an `HttpError` keeps its status and
          // code, anything else becomes the fixed 503.
          yield* Effect.tryPromise({
            try: () =>
              deps.adminClient.setAffiliation(
                group.roomLocalpart,
                jidFor(localpartFor(userId), deps.domain),
                'member',
              ),
            catch: (error) => (error instanceof HttpError ? error : xmppUnavailable()),
          });
          const inserted = yield* sql<{ userId: string }>`INSERT INTO group_members
              (group_id, user_id, role)
            VALUES (${link.groupId}, ${userId}, 'member')
            ON CONFLICT (group_id, user_id) DO NOTHING
            RETURNING user_id`;
          // No row inserted: another writer won and committed first, so the claim rolls back.
          return inserted.length > 0;
        }),
      );
    }),
  );
  if (!joined) {
    return { groupId: link.groupId, alreadyMember: true };
  }
  await finishJoin(deps, {
    userId,
    groupId: link.groupId,
    roomLocalpart: group.roomLocalpart,
    action: 'group.joined_by_link',
    subjectId: link.id,
    detail: { linkId: link.id, hint: link.tokenHint },
  });
  return { groupId: link.groupId, alreadyMember: false };
}

// Run before any use is claimed: people and AIs share MAX_GROUP_MEMBERS, and 409
// `group_full` answers when the newcomer would exceed it. The check is not atomic with
// the insert, so two racers for the last seat can exceed the cap by one — the same known,
// accepted race as `addGroupMembers`.
export async function assertGroupHasRoom(db: ServerDatabase, groupId: string): Promise<void> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM group_members
        WHERE group_id = ${groupId}`;
    }),
  );
  const memberTotal = Number(row?.total ?? 0);
  const [aiRow] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total FROM group_ais
        WHERE group_id = ${groupId}`;
    }),
  );
  if (memberTotal + Number(aiRow?.total ?? 0) + 1 > MAX_GROUP_MEMBERS) {
    throw new HttpError(409, 'group_full', 'This group is full');
  }
}

// Consumes one use atomically: the update only lands while the link is usable, so racing
// joins serialize on the row and at most `max_uses` win.
function claimLinkUse(
  sql: SqlClient.SqlClient,
  linkId: string,
  now: Date,
): Effect.Effect<boolean, SqlError.SqlError> {
  return Effect.gen(function* () {
    const rows = yield* sql<{ id: string }>`UPDATE group_invite_links
      SET uses = uses + 1
      WHERE id = ${linkId}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ${now.toISOString()})
        AND (max_uses IS NULL OR uses < max_uses)
      RETURNING id`;
    return rows.length > 0;
  });
}

// Every existing public topic room gains the newcomer, best effort after the commit. A
// failure is logged with the group id, never a topic name.
export async function syncPublicTopicsByLink(
  deps: InviteLinkServiceDeps,
  groupId: string,
): Promise<void> {
  const topicRows = await runSql(
    deps.db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  for (const topic of topicRows) {
    if (topic.archivedAt !== null) {
      continue;
    }
    try {
      await syncTopicRoom(
        { db: deps.db, adminClient: deps.adminClient, domain: deps.domain, logger: deps.logger },
        topic,
      );
    } catch {
      deps.logger.warn({ groupId }, 'could not sync a topic room after a link join');
    }
  }
}
