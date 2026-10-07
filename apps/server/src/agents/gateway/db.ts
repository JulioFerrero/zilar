import { and, eq, inArray } from 'drizzle-orm';
import type { ActiveAiForGateway } from '../../ais/service';
import type { ServerDatabase } from '../../db/client';
import {
  ais,
  groupAis,
  groupMembers,
  groups,
  topicAis,
  topicMembers,
  topics,
  user,
} from '../../db/schema';
import type { GroupRole } from '../../groups/service';
import { allowedTopicAiIds } from '../../topics/access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { normBareJid } from '../context';

export async function loadActiveAi(
  db: ServerDatabase,
  aiId: string,
): Promise<ActiveAiForGateway | null> {
  const [row] = await db
    .select({
      id: ais.id,
      jid: ais.jid,
      localpart: ais.localpart,
      owner: ais.owner,
      name: ais.name,
      persona: ais.persona,
    })
    .from(ais)
    .where(and(eq(ais.id, aiId), eq(ais.status, 'active')))
    .limit(1);
  return row ?? null;
}

export async function loadOwnerName(db: ServerDatabase, ownerId: string): Promise<string> {
  const [row] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, ownerId))
    .limit(1);
  const name = row?.name?.trim() ?? '';
  return name === '' ? 'owner' : name;
}

// Every room an AI belongs to (T-0109): for each `group_ais` row the
// group's General room, plus each non-archived topic where the AI is in
// `topic_ais`. Every subscription carries the topic id (and still the group
// id) so the turn knows which topic it is answering in.
export async function listAiRooms(
  db: ServerDatabase,
  aiId: string,
): Promise<Array<{ groupId: string; topicId: string; roomLocalpart: string }>> {
  const groupRows = await db
    .select({ groupId: groupAis.groupId, roomLocalpart: groups.roomLocalpart })
    .from(groupAis)
    .innerJoin(groups, eq(groups.id, groupAis.groupId))
    .where(eq(groupAis.aiId, aiId));
  if (groupRows.length === 0) {
    return [];
  }
  const groupIds = groupRows.map((row) => row.groupId);
  const topicRows = await db
    .select({
      id: topics.id,
      groupId: topics.groupId,
      roomLocalpart: topics.roomLocalpart,
      visibility: topics.visibility,
      isGeneral: topics.isGeneral,
      archivedAt: topics.archivedAt,
    })
    .from(topics)
    .where(inArray(topics.groupId, groupIds));
  const topicAiRows = await db
    .select({ topicId: topicAis.topicId })
    .from(topicAis)
    .where(eq(topicAis.aiId, aiId));
  const inTopic = new Set(topicAiRows.map((row) => row.topicId));
  // The owner's visibility is a live derived rule (see `allowedTopicAiIds`):
  // a private topic counts only while the AI's owner is a topic member. The
  // rows stay, so adding the owner back brings the AI back automatically.
  const allowedByTopic = new Map<string, Set<string>>();
  for (const topic of topicRows) {
    if (!topic.isGeneral && topic.archivedAt === null && inTopic.has(topic.id)) {
      allowedByTopic.set(topic.id, await allowedTopicAiIds(db, topic));
    }
  }
  const rooms: Array<{ groupId: string; topicId: string; roomLocalpart: string }> = [];
  for (const topic of topicRows) {
    if (topic.isGeneral) {
      continue;
    }
    if (topic.archivedAt !== null) {
      continue;
    }
    if (inTopic.has(topic.id) && (allowedByTopic.get(topic.id)?.has(aiId) ?? false)) {
      rooms.push({ groupId: topic.groupId, topicId: topic.id, roomLocalpart: topic.roomLocalpart });
    }
  }
  // General rooms ride on the `group_ais` rows themselves (one General topic
  // per group, always public, never archived).
  const generals = new Map(
    topicRows.filter((row) => row.isGeneral).map((row) => [row.groupId, row]),
  );
  for (const group of groupRows) {
    const general = generals.get(group.groupId);
    if (general) {
      rooms.push({
        groupId: group.groupId,
        topicId: general.id,
        roomLocalpart: general.roomLocalpart,
      });
    } else {
      // No General row yet (pre-backfill data in a test): fall back to the
      // group's own room so existing AIs keep answering in General.
      rooms.push({ groupId: group.groupId, topicId: '', roomLocalpart: group.roomLocalpart });
    }
  }
  return rooms;
}

interface RoomGateState {
  /** Bare JIDs of the current human members, lowercased. */
  memberJids: Set<string>;
  /** Per-member role for the gate that decides whether a sender may wake an
   * AI for an action (T-0098). Keys are lowercased bare JIDs. */
  memberRolesByJid: Map<string, GroupRole>;
}

// The fresh gate for one topic turn: who may trigger the AI, and which
// nicks belong to AIs. For a General topic the humans are every group
// member; for any other topic they are that topic's members (public topics:
// every group member; private topics: the `topic_members` rows). Member JIDs
// are derived with the same `localpartFor` the provisioning uses, so no
// extra mapping table is needed. Roles come from `group_members` and are
// looked up per turn so a promotion or demotion that lands between turns is
// picked up the next time the AI wakes. A message from someone who is not a
// topic member cannot wake the AI (they cannot even be in the room, but it
// is asserted anyway). The `request_action` role check (T-0098: sender is
// group owner/admin) stays, and additionally requires the sender to be in
// the topic.
export async function loadRoomGateState(
  db: ServerDatabase,
  groupId: string,
  domain: string,
  topicId: string,
): Promise<RoomGateState | null> {
  const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return null;
  }
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  let memberIds: Set<string> | null = null;
  if (topic && !topic.isGeneral && topic.visibility === 'private') {
    const rows = await db
      .select({ userId: topicMembers.userId })
      .from(topicMembers)
      .where(eq(topicMembers.topicId, topic.id));
    memberIds = new Set(rows.map((row) => row.userId));
  }
  const members = await db
    .select({ userId: groupMembers.userId, role: groupMembers.role })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  const memberRolesByJid = new Map<string, GroupRole>();
  const memberJids = new Set<string>();
  for (const row of members) {
    if (memberIds !== null && !memberIds.has(row.userId)) {
      continue;
    }
    const bare = normBareJid(jidFor(localpartFor(row.userId), domain));
    memberJids.add(bare);
    memberRolesByJid.set(bare, row.role);
  }
  return { memberJids, memberRolesByJid };
}
