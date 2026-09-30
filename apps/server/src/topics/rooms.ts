import { eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { ais, groupAis, groupMembers, groups, topicAis, topicMembers } from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient, RoomAffiliation } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { InviteLogger } from '../groups/service';
import { topicRoleHolderIds } from '../roles/service';
import { allowedTopicAiIds, type TopicRow } from './access';

export interface TopicRoomDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
}

// Who belongs in the topic's room: every group member for a public topic,
// `topic_members` plus the holders of its roles for a private one, plus the
// AI memberships — every `group_ais` AI for General, the topic's
// `topic_ais` rows otherwise.
// The return maps each JID to the affiliation it should hold: the group owner
// is the room's owner for General; for other topics the topic creator is
// owner (when they are still allowed in), everyone else is a member. AIs are
// always plain members. An AI that is not a member of a private topic is
// never included, even when it is in the group: the room itself enforces it.
// T-0124: a channel's General topic (its feed) keeps the voice mapping —
// owner stays `owner`, admins stay `admin` (voice in the moderated room),
// subscribers stay `member` (visitors, voiceless) — so a later join/leave
// re-sync never demotes an admin back to a subscriber.
export async function desiredMembers(
  db: ServerDatabase,
  topic: TopicRow,
  domain: string,
): Promise<Map<string, RoomAffiliation>> {
  const wanted = new Map<string, RoomAffiliation>();
  if (topic.visibility !== 'private') {
    const [group] = await db
      .select({ kind: groups.kind })
      .from(groups)
      .where(eq(groups.id, topic.groupId))
      .limit(1);
    const isChannelFeed = topic.isGeneral && group?.kind === 'channel';
    const rows = await db
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, topic.groupId));
    for (const row of rows) {
      if (isChannelFeed && row.role === 'admin') {
        wanted.set(jidFor(localpartFor(row.userId), domain), 'admin');
        continue;
      }
      const ownerAffiliation = topic.isGeneral
        ? row.role === 'owner'
        : row.userId === topic.createdBy;
      wanted.set(jidFor(localpartFor(row.userId), domain), ownerAffiliation ? 'owner' : 'member');
    }
    await addTopicAiMembers(db, topic, wanted);
    // T-0124: an AI posts in the feed only while its owner is a channel
    // admin (the add flow already requires the actor to own the AI and
    // administer the channel). Admin-owned AIs hold affiliation `admin`
    // (voice); any other AI stays a voiceless `member`. Evaluated live, so
    // demoting the owner drops the AI's voice at the next sync without
    // deleting the row.
    if (isChannelFeed) {
      await applyChannelAiVoice(db, topic, wanted);
    }
    return wanted;
  }
  const groupRows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, topic.groupId));
  const byId = new Map(groupRows.map((row) => [row.userId, row.role]));
  const memberRows = await db
    .select({ userId: topicMembers.userId })
    .from(topicMembers)
    .where(eq(topicMembers.topicId, topic.id));
  // T-0116: holders of the topic's roles join too (still group members).
  // A holder who is also a direct member keeps their single affiliation.
  const holderIds = await topicRoleHolderIds(db, topic.id, topic.groupId);
  for (const row of memberRows) {
    // A stale `topic_members` row for a user who left the group no longer
    // counts: public sync would drop them, private sync must too.
    if (!byId.has(row.userId)) {
      continue;
    }
    const ownerAffiliation = topic.isGeneral
      ? byId.get(row.userId) === 'owner'
      : row.userId === topic.createdBy;
    wanted.set(jidFor(localpartFor(row.userId), domain), ownerAffiliation ? 'owner' : 'member');
  }
  for (const userId of holderIds) {
    const jid = jidFor(localpartFor(userId), domain);
    if (wanted.has(jid)) {
      continue;
    }
    const ownerAffiliation = topic.isGeneral
      ? byId.get(userId) === 'owner'
      : userId === topic.createdBy;
    wanted.set(jid, ownerAffiliation ? 'owner' : 'member');
  }
  await addTopicAiMembers(db, topic, wanted);
  return wanted;
}

// AI affiliations for one topic room: every group AI for General, the
// topic's allowed `topic_ais` rows otherwise (see `allowedTopicAiIds`: for a
// private topic an AI counts only while its owner is a topic member, so the
// sync removes the AI from the room once its owner is not a member —
// without deleting the row, so adding the owner back brings it back). Only
// active AIs join a room; a stale row for a stopped or disabled AI no longer
// counts. AIs invited into an archived topic are dropped too: archiving
// keeps the rows but the gateway leaves the room.
async function addTopicAiMembers(
  db: ServerDatabase,
  topic: TopicRow,
  wanted: Map<string, RoomAffiliation>,
): Promise<void> {
  if (topic.archivedAt !== null) {
    return;
  }
  if (topic.isGeneral) {
    const rows = await db
      .select({ jid: ais.jid, status: ais.status })
      .from(groupAis)
      .innerJoin(ais, eq(ais.id, groupAis.aiId))
      .where(eq(groupAis.groupId, topic.groupId));
    for (const row of rows) {
      if (row.status === 'active' && !wanted.has(row.jid)) {
        wanted.set(row.jid, 'member');
      }
    }
    return;
  }
  const allowed = await allowedTopicAiIds(db, topic);
  if (allowed.size === 0) {
    return;
  }
  const rows = await db
    .select({ id: ais.id, jid: ais.jid })
    .from(topicAis)
    .innerJoin(ais, eq(ais.id, topicAis.aiId))
    .where(eq(topicAis.topicId, topic.id));
  for (const row of rows) {
    if (allowed.has(row.id) && !wanted.has(row.jid)) {
      wanted.set(row.jid, 'member');
    }
  }
}

// T-0124: voice for AIs in a channel feed. Every active group AI whose
// owner is currently a channel owner/admin holds affiliation `admin`
// (voice, so the gateway's post lands); any other AI keeps `member`
// (a visitor: reads, cannot post). The `group_ais` rows never change —
// demoting the owner drops the voice at the next sync, re-promoting
// brings it back.
async function applyChannelAiVoice(
  db: ServerDatabase,
  topic: TopicRow,
  wanted: Map<string, RoomAffiliation>,
): Promise<void> {
  const aiRows = await db
    .select({ jid: ais.jid, owner: ais.owner, status: ais.status })
    .from(groupAis)
    .innerJoin(ais, eq(ais.id, groupAis.aiId))
    .where(eq(groupAis.groupId, topic.groupId));
  if (aiRows.length === 0) {
    return;
  }
  const memberRows = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, topic.groupId));
  const roleById = new Map(memberRows.map((row) => [row.userId, row.role]));
  for (const ai of aiRows) {
    if (ai.status !== 'active' || !wanted.has(ai.jid)) {
      continue;
    }
    const ownerRole = roleById.get(ai.owner);
    wanted.set(ai.jid, ownerRole === 'owner' || ownerRole === 'admin' ? 'admin' : 'member');
  }
}

export interface SyncTopicRoomResult {
  added: string[];
  removed: string[];
}

// Applies `desiredMembers` to the room: sets the missing affiliations, sends
// a direct invitation to newly added users, and sets `none` for anyone who
// should no longer be there (in a members-only room this removes them).
// Idempotent. Affiliation read/apply failures are logged by class name only
// and rethrown as a 502/503 `HttpError` so a route answers instead of
// leaving the database and the room disagreeing silently.
export async function syncTopicRoom(
  deps: TopicRoomDeps,
  topic: TopicRow,
): Promise<SyncTopicRoomResult> {
  let wanted: Map<string, RoomAffiliation>;
  try {
    wanted = await desiredMembers(deps.db, topic, deps.domain);
  } catch (error) {
    deps.logger.warn({ err: errorName(error) }, 'could not read the topic members');
    throw mapRoomError(error);
  }

  let current: Array<{ jid: string; affiliation: string }>;
  try {
    current = await deps.adminClient.getAffiliations(topic.roomLocalpart);
  } catch (error) {
    deps.logger.warn(
      { err: errorName(error), roomLocalpart: topic.roomLocalpart },
      'could not read the topic room affiliations',
    );
    throw mapRoomError(error);
  }

  const currentByJid = new Map(current.map((entry) => [entry.jid, entry.affiliation]));
  const added: string[] = [];
  const removed: string[] = [];
  for (const [jid, affiliation] of wanted) {
    if (currentByJid.get(jid) !== affiliation) {
      try {
        await deps.adminClient.setAffiliation(topic.roomLocalpart, jid, affiliation);
      } catch (error) {
        deps.logger.warn(
          { err: errorName(error), roomLocalpart: topic.roomLocalpart },
          'could not set the topic room affiliation',
        );
        throw mapRoomError(error);
      }
      added.push(jid);
    }
  }
  for (const [jid] of currentByJid) {
    if (!wanted.has(jid) && currentByJid.get(jid) !== 'none') {
      try {
        await deps.adminClient.setAffiliation(topic.roomLocalpart, jid, 'none');
      } catch (error) {
        deps.logger.warn(
          { err: errorName(error), roomLocalpart: topic.roomLocalpart },
          'could not remove the topic room affiliation',
        );
        throw mapRoomError(error);
      }
      removed.push(jid);
    }
  }

  if (added.length > 0) {
    try {
      await deps.adminClient.sendDirectInvitation(topic.roomLocalpart, added);
    } catch (error) {
      deps.logger.warn(
        { err: errorName(error), roomLocalpart: topic.roomLocalpart },
        'could not send the topic invitations',
      );
    }
  }
  return { added, removed };
}

function mapRoomError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(502, 'xmpp_unavailable', 'The chat service is temporarily unavailable');
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
