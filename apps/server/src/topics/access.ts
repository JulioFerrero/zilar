import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupMemberRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { holdsTopicRole } from '../roles/service';

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

export type {
  TopicActivityEntry,
  TopicAiView,
  TopicKind,
  TopicOwnerView,
  TopicRoleView,
  TopicRow,
  TopicStatus,
  TopicView,
  TopicVisibility,
} from './types';
export { topicKindSchema, topicStatusSchema, topicVisibilitySchema } from './types';
export { aiMayBeInTopic, allowedTopicAiIds } from './ai-access';

export {
  countTopicMembers,
  resolveOwnerName,
  toTopicView,
  listTopicAis,
  toTopicViews,
} from './views';
