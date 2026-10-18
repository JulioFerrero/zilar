// Topic visibility and access. Every query runs on the `effect/sql` client
// registered for this database (see `../effect/sql`). The exported functions
// stay `async` so routes and tests keep their shape during the transition.
//
// Rows keep their camelCase shapes: `transformResultNames` camelCases the
// `topics` and `group_members` columns into `TopicRow` and the row types here.
//
// T-1546: the schemas and view types live in `./types`, and the AI-in-topic
// checks in `./ai-access`; this file re-exports them all, so importers stay.

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { GroupMemberRow, TopicRow } from '../db/rows';
import { runSql } from '../effect/sql';
import { HttpError } from '../errors';
import { holdsTopicRole } from '../roles/service';

const MISSING_TOPIC_MESSAGE = 'Topic not found';
// Byte-identical for a missing topic id and for a topic the caller may not
// see, so ids cannot be probed.
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

// Whether the user may see the topic: group member, topic not archived, and
// (for private topics) a row in `topic_members` or a role in
// `topic_role_access` (T-0116). Never throws for a missing topic: callers
// answer the same 404 either way.
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

// T-1757: whether the user belongs to the topic itself. Only General is the
// whole group; every other topic owns its member list, so membership is a
// `topic_members` row or a holder of one of its roles. Group membership is
// checked by the caller where it matters.
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

// Every non-archived topic of the group the user may see.
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
  let privateSeen = new Set<string>();
  if (privateIds.length > 0) {
    const memberRows = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<{ topicId: string }>`SELECT topic_id FROM topic_members
          WHERE topic_id IN ${sql.in(privateIds)} AND user_id = ${userId}`;
      }),
    );
    privateSeen = new Set(memberRows.map((row) => row.topicId));
    // T-0116: topics reached through a role, not a direct row.
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
      privateSeen.add(row.topicId);
    }
  }
  return active.filter((row) => row.visibility !== 'private' || privateSeen.has(row.id));
}

// Managing a topic (rename, kind, visibility, archive, members): the topic
// creator, or a group owner/admin who can also see it. T-1990: General is the
// group itself, so its manager rights follow the current owner/admins and
// never the (possibly demoted) creator. Returns false for a missing topic or a
// caller who may not see it — the routes answer 404.
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
