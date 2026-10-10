import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import type { TopicRow } from '../topics/access';
import type { RoutineRow } from './service';

// The module's own reads on `effect/sql`. `SELECT *` returns camelCased
// columns (see `../effect/sql`), so the rows keep the `TopicRow` and
// `RoutineRow` shapes the access helpers and wire mappers already expect.
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

export async function findMembership(db: ServerDatabase, groupId: string, userId: string) {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ role: 'owner' | 'admin' | 'member' }>`SELECT role FROM group_members
        WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    }),
  );
  return row ?? null;
}
