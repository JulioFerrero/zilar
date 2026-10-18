import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { avatarIdsByOwner, avatarUrlFor } from '../avatars/service';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { canSeeTopic, type TopicRow } from '../topics/access';
import { listRoutinesForTopic, toPublicRoutines } from './queries';
import type { PublicRoutine } from './schemas';
import type { RoutineRow } from './service';

// `SELECT *` returns camelCased columns, so rows keep the shapes the access helpers expect.
export async function findTopicById(db: ServerDatabase, topicId: string): Promise<TopicRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id = ${topicId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function listTopicsByGroup(db: ServerDatabase, groupId: string): Promise<TopicRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}`;
    }),
  );
  return [...rows];
}

export async function findRoutineById(
  db: ServerDatabase,
  routineId: string,
): Promise<RoutineRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<RoutineRow>`SELECT * FROM routines WHERE id = ${routineId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function findAiOwner(
  db: ServerDatabase,
  aiId: string,
): Promise<{ owner: string } | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ owner: string }>`SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function findOwnedAiRow(db: ServerDatabase, aiId: string, ownerId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`SELECT id FROM ais
        WHERE id = ${aiId} AND owner = ${ownerId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

// A routine row plus the AI's name and JID (the DM chat of a personal routine).
export interface MyRoutineRow extends RoutineRow {
  aiName: string;
  aiJid: string;
}

export interface MyRoutineView {
  routine: PublicRoutine;
  aiName: string;
  aiAvatarUrl: string | undefined;
  chatName: string | null;
  chatJid: string | null;
}

// Every non-deleted routine of every AI the caller owns, with the AI's name.
export async function listRoutinesForOwner(
  db: ServerDatabase,
  ownerId: string,
): Promise<MyRoutineRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MyRoutineRow>`SELECT r.*, a.name AS ai_name, a.jid AS ai_jid FROM routines r
        INNER JOIN ais a ON a.id = r.ai_id
        WHERE a.owner = ${ownerId} AND r.deleted_at IS NULL`;
    }),
  );
  return [...rows];
}

async function findTopicsByIds(
  db: ServerDatabase,
  topicIds: string[],
): Promise<Map<string, TopicRow>> {
  if (topicIds.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<TopicRow>`SELECT * FROM topics WHERE id IN ${sql.in(topicIds)}`;
    }),
  );
  return new Map(rows.map((row) => [row.id, row]));
}

async function findGroupTitlesByIds(
  db: ServerDatabase,
  groupIds: string[],
): Promise<Map<string, string>> {
  if (groupIds.length === 0) {
    return new Map();
  }
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; title: string }>`SELECT id, title FROM groups
        WHERE id IN ${sql.in(groupIds)}`;
    }),
  );
  return new Map(rows.map((row) => [row.id, row.title]));
}

// The caller's routines across every AI they own, with the AI's name, picture and chat name.
// A routine in a private topic the caller cannot see is left out; one query each for routines, topics, groups and avatars.
export async function listMyRoutines(
  db: ServerDatabase,
  userId: string,
  mucDomain?: string,
): Promise<MyRoutineView[]> {
  const rows = await listRoutinesForOwner(db, userId);

  const topicIds = [...new Set(rows.flatMap((row) => (row.topicId === null ? [] : [row.topicId])))];
  const topics = await findTopicsByIds(db, topicIds);
  const groupIds = [
    ...new Set(
      [...topics.values()].filter((topic) => topic.isGeneral).map((topic) => topic.groupId),
    ),
  ];
  const groupTitles = await findGroupTitlesByIds(db, groupIds);

  const visible: MyRoutineRow[] = [];
  const chatNames = new Map<string, string | null>();
  const chatJids = new Map<string, string | null>();
  for (const row of rows) {
    if (row.topicId === null) {
      visible.push(row);
      chatJids.set(row.id, row.aiJid);
      continue;
    }
    const topic = topics.get(row.topicId);
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      continue;
    }
    visible.push(row);
    chatNames.set(
      row.id,
      topic.isGeneral ? (groupTitles.get(topic.groupId) ?? topic.name) : topic.name,
    );
    chatJids.set(
      row.id,
      mucDomain === undefined ? null : `${topic.roomLocalpart}@${mucDomain}`.toLowerCase(),
    );
  }

  const byId = new Map(visible.map((row) => [row.id, row]));
  const routines = await toPublicRoutines(db, visible);
  const avatars = await avatarIdsByOwner(
    db,
    'ai',
    routines.map((routine) => routine.aiId),
  );

  const result: MyRoutineView[] = [];
  for (const routine of routines) {
    const row = byId.get(routine.id);
    if (!row) {
      continue;
    }
    const avatarId = avatars.get(routine.aiId);
    result.push({
      routine,
      aiName: row.aiName,
      aiAvatarUrl: avatarId === undefined ? undefined : avatarUrlFor(avatarId),
      chatName: chatNames.get(routine.id) ?? null,
      chatJid: chatJids.get(routine.id) ?? null,
    });
  }
  return result;
}

// A missing topic and one the caller may not see both answer null, so ids cannot be probed.
export async function listVisibleTopicRoutines(
  db: ServerDatabase,
  topicId: string,
  userId: string,
): Promise<PublicRoutine[] | null> {
  const topic = await findTopicById(db, topicId);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    return null;
  }
  return listRoutinesForTopic(db, topicId);
}
