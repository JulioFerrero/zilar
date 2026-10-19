import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ActiveAiForGateway } from '../../ais/queries';
import type { ServerDatabase } from '../../db/client';
import type { TopicMemberRow } from '../../db/rows';
import { runSql } from '../../effect/sql';
import { allowedTopicAiIds } from '../../topics/access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { normBareJid } from '../context';
import { type GroupRole } from '../../groups/schemas';
import { topicRoleHolderIds } from '../../roles/access';

interface OwnerNameRow {
  name: string;
}

interface GroupRoomRow {
  groupId: string;
  roomLocalpart: string;
}

interface TopicRowForRooms {
  id: string;
  groupId: string;
  roomLocalpart: string;
  visibility: 'public' | 'private';
  isGeneral: boolean;
  archivedAt: Date | null;
}

interface TopicAiRow {
  topicId: string;
}

interface GroupIdRow {
  id: string;
}

interface GateTopicRow {
  id: string;
  isGeneral: boolean;
  visibility: 'public' | 'private';
}

interface AiOwnerRow {
  owner: string;
}

interface RoomLocalpartRow {
  roomLocalpart: string;
}

interface TopicRoomRow {
  roomLocalpart: string;
  archivedAt: Date | null;
}

interface GroupListenerSettings {
  listenerEnabled: boolean;
  listenerEagerness: 'quiet' | 'normal' | 'eager';
}

interface TopicIsGeneralRow {
  isGeneral: boolean;
}

interface GroupMemberRow {
  userId: string;
  role: GroupRole;
}

export async function loadActiveAi(
  db: ServerDatabase,
  aiId: string,
): Promise<ActiveAiForGateway | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<ActiveAiForGateway>`SELECT id, jid, localpart, owner, name, persona, computer_mode, machine_id
        FROM ais
        WHERE id = ${aiId} AND status = 'active'
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function loadOwnerName(db: ServerDatabase, ownerId: string): Promise<string> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<OwnerNameRow>`SELECT name FROM "user" WHERE id = ${ownerId} LIMIT 1`;
    }),
  );
  const name = row?.name?.trim() ?? '';
  return name === '' ? 'owner' : name;
}

export async function listAiRooms(
  db: ServerDatabase,
  aiId: string,
): Promise<Array<{ groupId: string; topicId: string; roomLocalpart: string }>> {
  const groupRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupRoomRow>`SELECT ga.group_id, g.room_localpart
        FROM group_ais ga
        INNER JOIN groups g ON g.id = ga.group_id
        INNER JOIN "ais" a ON a.id = ga.ai_id
        INNER JOIN group_members gm ON gm.group_id = ga.group_id AND gm.user_id = a.owner
        WHERE ga.ai_id = ${aiId}`;
    }),
  );
  if (groupRows.length === 0) {
    return [];
  }
  const groupIds = groupRows.map((row) => row.groupId);
  const topicRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRowForRooms>`SELECT id, group_id, room_localpart, visibility, is_general, archived_at
        FROM topics
        WHERE group_id IN ${sql.in(groupIds)}`;
    }),
  );
  const topicAiRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicAiRow>`SELECT topic_id FROM topic_ais WHERE ai_id = ${aiId}`;
    }),
  );
  const inTopic = new Set(topicAiRows.map((row) => row.topicId));
  // The owner's membership is a live derived rule (see `allowedTopicAiIds`):
  // a non-General topic counts only while the AI's owner is a topic member
  // (and still in the group). The rows stay, so adding the owner back brings
  // the AI back automatically.
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
  // per group, always public, never archived), and only while the AI's owner
  // is still a group member.
  const generals = new Map(
    topicRows.filter((row) => row.isGeneral).map((row) => [row.groupId, row] as const),
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

export async function loadAiOwnerId(db: ServerDatabase, aiId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<AiOwnerRow>`SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return row?.owner ?? null;
}

export async function loadGroupRoomLocalpart(
  db: ServerDatabase,
  groupId: string,
): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoomLocalpartRow>`SELECT room_localpart FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  return row?.roomLocalpart ?? null;
}

export async function loadTopicRoomRow(
  db: ServerDatabase,
  topicId: string,
): Promise<{ roomLocalpart: string; archivedAt: Date | null } | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRoomRow>`SELECT room_localpart, archived_at FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row === undefined
    ? null
    : { roomLocalpart: row.roomLocalpart, archivedAt: row.archivedAt };
}

export async function loadGroupListenerSettings(
  db: ServerDatabase,
  groupId: string,
): Promise<GroupListenerSettings | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupListenerSettings>`SELECT listener_enabled, listener_eagerness FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function loadTopicIsGeneral(
  db: ServerDatabase,
  topicId: string,
): Promise<boolean | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicIsGeneralRow>`SELECT is_general FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row?.isGeneral ?? null;
}

export async function loadGroupTitle(db: ServerDatabase, groupId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ title: string }>`SELECT title FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  return row?.title ?? null;
}

export async function loadTopicName(db: ServerDatabase, topicId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ name: string }>`SELECT name FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row?.name ?? null;
}

interface DelegationFlagRow {
  id: string;
  accepts: boolean;
  canDelegate: boolean;
}

export async function loadDelegationFlags(
  db: ServerDatabase,
  aiIds: string[],
): Promise<readonly DelegationFlagRow[]> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<DelegationFlagRow>`SELECT id, accepts_delegation AS accepts, can_delegate
        FROM ais
        WHERE id IN ${sql.in(aiIds)}`;
    }),
  );
}

export interface RoomGateState {
  /** Bare JIDs of the current human members, lowercased. */
  memberJids: Set<string>;
  memberRolesByJid: Map<string, GroupRole>;
}

// The fresh gate for one topic turn: who may trigger the AI, and which nicks
// belong to AIs. For General the humans are every group member; otherwise they
// are the topic's members plus its role holders. JIDs are derived with the same
// `localpartFor` as provisioning. Roles are read per turn, so a promotion or
// demotion applies on the next wake. A non-member cannot even be in the room,
// but it is asserted anyway. A `request_action` also needs a group owner/admin
// role and topic membership.
export async function loadRoomGateState(
  db: ServerDatabase,
  groupId: string,
  domain: string,
  topicId: string,
): Promise<RoomGateState | null> {
  const [group] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupIdRow>`SELECT id FROM groups WHERE id = ${groupId} LIMIT 1`;
    }),
  );
  if (!group) {
    return null;
  }
  const [topic] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GateTopicRow>`SELECT id, is_general, visibility
        FROM topics
        WHERE id = ${topicId}
        LIMIT 1`;
    }),
  );
  let memberIds: Set<string> | null = null;
  if (topic && !topic.isGeneral) {
    const rows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<
          Pick<TopicMemberRow, 'userId'>
        >`SELECT user_id FROM topic_members WHERE topic_id = ${topic.id}`;
      }),
    );
    memberIds = new Set(rows.map((row) => row.userId));
    for (const holder of await topicRoleHolderIds(db, topic.id, groupId)) {
      memberIds.add(holder);
    }
  }
  const members = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupMemberRow>`SELECT user_id, role FROM group_members WHERE group_id = ${groupId}`;
    }),
  );
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
