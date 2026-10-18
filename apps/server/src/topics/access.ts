import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupMemberRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { holdsTopicRole, topicRoleHolderIds } from '../roles/service';
import type { AiActivityState } from './ai-activity';

export type { TopicRow };

// Whether an AI may be in a topic's room: the derived rule that keeps an AI
// from reading a conversation its owner cannot see. Only General is the
// whole group and has no `topic_ais` rows; elsewhere a row counts only while
// the AI's owner is a topic member still in the group. The rows are never
// deleted because this is evaluated live, so it cannot drift.
export async function aiMayBeInTopic(
  db: ServerDatabase,
  topic: TopicRow,
  ai: { id: string; owner: string; status: string },
): Promise<boolean> {
  if (topic.isGeneral || topic.archivedAt !== null || ai.status !== 'active') {
    return false;
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ aiId: string }>`SELECT ai_id FROM topic_ais
        WHERE topic_id = ${topic.id} AND ai_id = ${ai.id}
        LIMIT 1`;
    }),
  );
  if (!row) {
    return false;
  }
  // A non-General topic allows the AI only while its owner is a topic member;
  // `canSeeTopic` stays true for every member on a public topic, so it is not
  // enough here.
  if (!(await isTopicMember(db, topic.id, ai.owner))) {
    return false;
  }
  // The owner must still be in the group too, so a half-finished leave cannot
  // make the two AI rules disagree.
  return (await getGroupMembership(db, topic.groupId, ai.owner)) !== null;
}

// The AI ids currently allowed in one topic; the fast path for the gateway
// listing. Takes the narrow slice of the topic row the rule reads.
export async function allowedTopicAiIds(
  db: ServerDatabase,
  topic: Pick<TopicRow, 'id' | 'groupId' | 'visibility' | 'isGeneral' | 'archivedAt'>,
): Promise<Set<string>> {
  if (topic.isGeneral || topic.archivedAt !== null) {
    return new Set();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        aiId: string;
        owner: string;
        status: string;
      }>`SELECT ta.ai_id, a.owner, a.status
        FROM topic_ais ta
        INNER JOIN ais a ON a.id = ta.ai_id
        WHERE ta.topic_id = ${topic.id}`;
    }),
  );
  const active = rows.filter((row) => row.status === 'active');
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topic.id}`;
    }),
  );
  const memberIds = new Set(memberRows.map((row) => row.userId));
  // An owner who reaches the topic only through a role keeps their AI in the
  // room, like the room sync.
  for (const holder of await topicRoleHolderIds(db, topic.id, topic.groupId)) {
    memberIds.add(holder);
  }
  const groupRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM group_members
        WHERE group_id = ${topic.groupId}`;
    }),
  );
  const groupIds = new Set(groupRows.map((row) => row.userId));
  return new Set(
    active
      .filter((row) => memberIds.has(row.owner) && groupIds.has(row.owner))
      .map((row) => row.aiId),
  );
}

const MISSING_TOPIC_MESSAGE = 'Topic not found';
// A missing topic id and one the caller may not see answer
// byte-identically, so ids cannot be probed.
export const TOPIC_NOT_FOUND = {
  status: 404 as const,
  code: 'not_found',
  message: 'Topic not found',
};

export function toMissingTopic(): HttpError {
  return new HttpError(TOPIC_NOT_FOUND.status, TOPIC_NOT_FOUND.code, MISSING_TOPIC_MESSAGE);
}

export async function getTopic(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function getGroupMembership(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<{ groupId: string; userId: string; role: 'owner' | 'admin' | 'member' } | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<GroupMemberRow>`SELECT * FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId}
        LIMIT 1`;
    }),
  );
  return row ?? null;
}

async function isPrivateMember(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ userId: string }>`SELECT user_id FROM topic_members
        WHERE topic_id = ${topicId} AND user_id = ${userId}
        LIMIT 1`;
    }),
  );
  return row !== undefined;
}

// Whether the user may see the topic: group member, not archived, and for
// private topics a member row or a role. Never throws for a missing topic;
// callers answer the same 404 either way.
export async function canSeeTopic(
  db: ServerDatabase,
  topic: TopicRow,
  userId: string,
): Promise<boolean> {
  if (topic.archivedAt !== null) {
    return false;
  }
  const membership = await getGroupMembership(db, topic.groupId, userId);
  if (!membership) {
    return false;
  }
  if (topic.visibility !== 'private') {
    return true;
  }
  if (await isPrivateMember(db, topic.id, userId)) {
    return true;
  }
  return holdsTopicRole(db, topic.id, userId);
}

// Whether the user belongs to the topic itself: only General is the whole
// group; every other topic owns its member list (a `topic_members` row or a
// role holder).
export async function isTopicMember(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<boolean> {
  if (await isPrivateMember(db, topicId, userId)) {
    return true;
  }
  return holdsTopicRole(db, topicId, userId);
}

export async function requireVisibleTopic(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<TopicRow> {
  const topic = await getTopic(db, topicId);
  if (!topic) {
    throw toMissingTopic();
  }
  if (!(await canSeeTopic(db, topic, userId))) {
    throw toMissingTopic();
  }
  return topic;
}

// The ids among `privateIds` the user may see: a direct row or a role.
export async function visiblePrivateTopicIds(
  db: ServerDatabase,
  privateIds: string[],
  userId: string,
): Promise<Set<string>> {
  if (privateIds.length === 0) {
    return new Set();
  }
  const memberRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_members
        WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${userId}`;
    }),
  );
  const visible = new Set(memberRows.map((row) => row.topicId));
  // Topics reached through a role, not a direct row.
  const roleRows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ topicId: string }>`SELECT tra.topic_id FROM topic_role_access tra
        INNER JOIN group_member_roles gmr ON gmr.role_id = tra.role_id
        WHERE tra.topic_id IN ${sql.in(privateIds)} AND gmr.user_id = ${userId}`;
    }),
  );
  for (const row of roleRows) {
    visible.add(row.topicId);
  }
  return visible;
}

export async function visibleTopics(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  const active = rows.filter((row) => row.archivedAt === null);
  if (active.length === 0) {
    return [];
  }
  const membership = await getGroupMembership(db, groupId, userId);
  if (!membership) {
    return [];
  }
  const privateIds = active.filter((row) => row.visibility === 'private').map((row) => row.id);
  const privateSeen = await visiblePrivateTopicIds(db, privateIds, userId);
  return active.filter((row) => row.visibility !== 'private' || privateSeen.has(row.id));
}

// Managing a topic: the creator, or a group owner/admin who can see it.
// General is the group itself, so its rights follow the current
// owner/admins, never the creator. False for a missing topic or a caller
// who may not see it.
export async function canManageTopic(
  db: ServerDatabase,
  topic: TopicRow,
  userId: string,
): Promise<boolean> {
  if (topic.archivedAt !== null) {
    return false;
  }
  if (!(await canSeeTopic(db, topic, userId))) {
    return false;
  }
  if (!topic.isGeneral && topic.createdBy === userId) {
    return true;
  }
  const membership = await getGroupMembership(db, topic.groupId, userId);
  return membership !== null && membership.role !== 'member';
}

export async function requireManagedTopic(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<TopicRow> {
  const topic = await requireVisibleTopic(db, topicId, userId);
  if (!topic.isGeneral && topic.createdBy === userId) {
    return topic;
  }
  const membership = await getGroupMembership(db, topic.groupId, userId);
  if (membership === null || membership.role === 'member') {
    throw new HttpError(
      403,
      'forbidden',
      'Only the topic creator or a group owner or admin can manage it',
    );
  }
  return topic;
}

// Creating a topic: group owner/admin always; plain members only when the
// group allows it.
export async function canCreateTopic(
  db: ServerDatabase,
  groupId: string,
  userId: string,
  membersCanCreateTopics: boolean,
): Promise<boolean> {
  const membership = await getGroupMembership(db, groupId, userId);
  if (!membership) {
    return false;
  }
  if (membership.role !== 'member') {
    return true;
  }
  return membersCanCreateTopics;
}

export const topicVisibilitySchema = Schema.Literals(['public', 'private']);
export type TopicVisibility = typeof topicVisibilitySchema.Type;

export const topicKindSchema = Schema.Literals(['chat', 'task', 'bug', 'ui', 'routine']);
export type TopicKind = typeof topicKindSchema.Type;

export const topicStatusSchema = Schema.Literals([
  'open',
  'in_progress',
  'in_review',
  'blocked',
  'done',
]);
export type TopicStatus = typeof topicStatusSchema.Type;

export interface TopicOwnerView {
  kind: 'user' | 'ai';
  id: string;
  name: string;
}

export interface TopicRoleView {
  id: string;
  name: string;
  memberCount: number;
}

/** One AI at work in a topic, with its state and picture. */
export interface TopicActivityEntry {
  aiId: string;
  name: string;
  /** The AI's bare JID, so the client can match its live card. */
  jid?: string;
  avatarUrl?: string;
  /** An open question makes the AI wait; this is the card's message id. */
  questionId?: string;
  state: AiActivityState;
}

export interface TopicView {
  id: string;
  groupId: string;
  name: string;
  glyph: string;
  chatJid: string;
  visibility: TopicVisibility;
  kind: TopicKind;
  status: TopicStatus;
  owner: TopicOwnerView | null;
  linkUrl: string | null;
  linkLabel: string | null;
  isGeneral: boolean;
  archived: boolean;
  /** When a person marked the topic done, an ISO time, null when open;
   * optional only so older fixtures typecheck. */
  doneAt?: string | null;
  memberCount: number;
  /** The people in this topic (General: the whole group; otherwise its
   * `topic_members` plus role holders), sorted; optional only so older
   * fixtures typecheck. */
  memberIds?: string[];
  /** AIs added to this topic (never private names). */
  ais: TopicAiView[];
  /** roles with access to this topic (empty for public topics). */
  roles: TopicRoleView[];
  /** the role whose holders may decide approvals here, if any. */
  approverRole: { id: string; name: string } | null;
  /** The AIs at work in this topic, idle ones left out; filled on the list
   * routes only. */
  activity?: TopicActivityEntry[];
}

export interface TopicAiView {
  id: string;
  name: string;
  /** the AI's picture; omitted when it has none. */
  avatarUrl?: string;
  /** the AI's JID, so its row can open the AI's chat. */
  jid?: string;
}

export {
  countTopicMembers,
  resolveOwnerName,
  toTopicView,
  listTopicAis,
  toTopicViews,
} from './views';
