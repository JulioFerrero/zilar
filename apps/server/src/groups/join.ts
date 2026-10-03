// Open join for public groups and channels (T-0164): any signed-in user
// may join with one request, no invite. The membership write reuses the
// invite-link join pieces (the XMPP room affiliation, the topic sync and
// the audit entry all happen) without duplicating the XMPP logic.

import { and, count, eq } from 'drizzle-orm';
import type { AuditRecorder } from '../audit/service';
import type { ServerDatabase } from '../db/client';
import { groupAis, groupMembers, groups } from '../db/schema';
import { HttpError } from '../errors';
import { syncPublicTopicsByLink, type InviteLinkServiceDeps } from '../invite-links/service';
import type { InviteLogger } from './service';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { EjabberdAdminClient } from '../xmpp/admin-client';
import { PUBLIC_GROUP_MAX_MEMBERS } from '../directory/service';

export interface JoinPublicGroupDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
  audit?: AuditRecorder;
}

export interface JoinPublicGroupResult {
  groupId: string;
  alreadyMember: boolean;
}

// Unknown and private groups answer the same 404, so group ids cannot be
// probed from here. A user already in the group gets the same answer as a
// success (idempotent). Beyond `PUBLIC_GROUP_MAX_MEMBERS` (people and AIs
// share it) the join answers 409 `group_full` — but the cap counts people
// only (see below), so in practice plain groups never hit it while the
// directory stays small; the count runs atomically inside the transaction.
// A room failure after the commit is best effort (logged, never thrown),
// like the other member flows; a room failure inside the transaction
// answers 503 with nothing committed.
export async function joinPublicGroup(
  deps: JoinPublicGroupDeps,
  groupId: string,
  userId: string,
): Promise<JoinPublicGroupResult> {
  const [group] = await deps.db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  // Private and unknown read the same: no oracle for strangers.
  if (!group || group.visibility !== 'public') {
    throw new HttpError(404, 'not_found', 'Group not found');
  }
  const [existing] = await deps.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  if (existing) {
    return { groupId, alreadyMember: true };
  }
  await assertLargeGroupHasRoom(deps.db, groupId);

  const linkDeps: InviteLinkServiceDeps = {
    db: deps.db,
    adminClient: deps.adminClient,
    domain: deps.domain,
    logger: deps.logger,
    ...(deps.audit === undefined ? {} : { audit: deps.audit }),
  };
  const joined = await deps.db.transaction(async (tx) => {
    const txDb = tx as unknown as ServerDatabase;
    const [inside] = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    if (inside) {
      return false;
    }
    // The cap is counted atomically here: the count and the insert share
    // the transaction, so concurrent joins serialize on the rows and never
    // exceed it — unlike the link flow's pre-check (kept for its
    // before-claim refusal), which this keeps too for the early 409.
    const [memberTotal] = await tx
      .select({ total: count() })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    if (Number(memberTotal?.total ?? 0) >= PUBLIC_GROUP_MAX_MEMBERS) {
      throw new HttpError(409, 'group_full', 'This group is full');
    }
    try {
      await deps.adminClient.setAffiliation(
        group.roomLocalpart,
        jidFor(localpartFor(userId), deps.domain),
        'member',
      );
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(503, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
    }
    const inserted = await txDb
      .insert(groupMembers)
      .values({ groupId, userId, role: 'member' })
      .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] })
      .returning();
    return inserted.length > 0;
  });
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

// The pre-transaction refusal: people and AIs share
// `PUBLIC_GROUP_MAX_MEMBERS` (a public group may grow far past the 50-seat
// private cap, which would otherwise answer `group_full` at once through
// the reused link-flow check). Kept outside the transaction so a full
// group answers 409 before any write, like the link flow; the atomic
// count inside the transaction is the backstop.
async function assertLargeGroupHasRoom(db: ServerDatabase, groupId: string): Promise<void> {
  const [memberTotal] = await db
    .select({ total: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const [aiTotal] = await db
    .select({ total: count() })
    .from(groupAis)
    .where(eq(groupAis.groupId, groupId));
  if (
    Number(memberTotal?.total ?? 0) + Number(aiTotal?.total ?? 0) + 1 >
    PUBLIC_GROUP_MAX_MEMBERS
  ) {
    throw new HttpError(409, 'group_full', 'This group is full');
  }
}
