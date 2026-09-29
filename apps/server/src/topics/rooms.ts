import { eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { ais, groupAis, groupMembers, topicAis, topicMembers } from '../db/schema';
import { HttpError } from '../errors';
import type { EjabberdAdminClient, RoomAffiliation } from '../xmpp/admin-client';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import type { InviteLogger } from '../groups/service';
import type { TopicRow } from './access';

export interface TopicRoomDeps {
  db: ServerDatabase;
  adminClient: EjabberdAdminClient;
  domain: string;
  logger: InviteLogger;
}

// Who belongs in the topic's room: every group member for a public topic,
// the `topic_members` rows for a private one, plus the AI memberships —
// every `group_ais` AI for General, the topic's `topic_ais` rows otherwise.
// The return maps each JID to the affiliation it should hold: the group owner
// is the room's owner for General; for other topics the topic creator is
// owner (when they are still allowed in), everyone else is a member. AIs are
// always plain members. An AI that is not a member of a private topic is
// never included, even when it is in the group: the room itself enforces it.
export async function desiredMembers(
  db: ServerDatabase,
  topic: TopicRow,
  domain: string,
): Promise<Map<string, RoomAffiliation>> {
  const wanted = new Map<string, RoomAffiliation>();
  if (topic.visibility !== 'private') {
    const rows = await db
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, topic.groupId));
    for (const row of rows) {
      const ownerAffiliation = topic.isGeneral
        ? row.role === 'owner'
        : row.userId === topic.createdBy;
      wanted.set(jidFor(localpartFor(row.userId), domain), ownerAffiliation ? 'owner' : 'member');
    }
    await addTopicAiMembers(db, topic, wanted);
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
  await addTopicAiMembers(db, topic, wanted);
  return wanted;
}

// AI affiliations for one topic room: every group AI for General, the
// topic's `topic_ais` rows otherwise. Only active AIs join a room; a stale
// row for a stopped or disabled AI no longer counts. AIs invited into an
// archived topic are dropped too: archiving keeps the rows but the gateway
// leaves the room.
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
  const rows = await db
    .select({ jid: ais.jid, status: ais.status })
    .from(topicAis)
    .innerJoin(ais, eq(ais.id, topicAis.aiId))
    .where(eq(topicAis.topicId, topic.id));
  for (const row of rows) {
    if (row.status === 'active' && !wanted.has(row.jid)) {
      wanted.set(row.jid, 'member');
    }
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
