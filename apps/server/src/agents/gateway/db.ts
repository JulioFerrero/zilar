import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ActiveAiForGateway } from '../../ais/service';
import type { ServerDatabase } from '../../db/client';
import { sqlRuntimeFor } from '../../effect/sql';
import type { GroupRole } from '../../groups/service';
import { allowedTopicAiIds } from '../../topics/access';
import { jidFor, localpartFor } from '../../xmpp/provisioning';
import { normBareJid } from '../context';

function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

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

interface EncryptedVirtualKeyRow {
  encryptedKey: string;
}

interface TopicMemberRow {
  userId: string;
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
      return yield* sql<ActiveAiForGateway>`SELECT id, jid, localpart, owner, name, persona
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

// Every room an AI belongs to (T-0109): for each `group_ais` row the
// group's General room, plus each non-archived topic where the AI is in
// `topic_ais`. Every subscription carries the topic id (and still the group
// id) so the turn knows which topic it is answering in.
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

export async function loadEncryptedVirtualKey(
  db: ServerDatabase,
  aiId: string,
): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<EncryptedVirtualKeyRow>`SELECT encrypted_key FROM llm_virtual_keys WHERE ai_id = ${aiId} LIMIT 1`;
    }),
  );
  return row?.encryptedKey ?? null;
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
  if (topic && !topic.isGeneral && topic.visibility === 'private') {
    const rows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<TopicMemberRow>`SELECT user_id FROM topic_members WHERE topic_id = ${topic.id}`;
      }),
    );
    memberIds = new Set(rows.map((row) => row.userId));
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
