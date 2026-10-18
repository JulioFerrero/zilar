// The routine's single live message: these helpers store, load and clear its id on the `routines` row.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

interface RoutineMessageRow {
  lastMessageId: string | null;
  lastMessageAt: Date | null;
}

// The routine's stored message, or null when it has none or is deleted.
export async function loadRoutineMessage(
  db: ServerDatabase,
  routineId: string,
): Promise<{ messageId: string; at: Date } | null> {
  const row = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const [found] = yield* sql<RoutineMessageRow>`SELECT last_message_id, last_message_at
        FROM routines WHERE id = ${routineId} AND deleted_at IS NULL LIMIT 1`;
      return found ?? null;
    }),
  );
  if (!row || row.lastMessageId === null || row.lastMessageAt === null) {
    return null;
  }
  return { messageId: row.lastMessageId, at: row.lastMessageAt };
}

// Stamps the posted message id and the time it was posted.
export async function recordRoutineMessage(
  db: ServerDatabase,
  routineId: string,
  messageId: string,
  at: Date,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_message_id = ${messageId}, last_message_at = ${at}, updated_at = ${at}
        WHERE id = ${routineId}`;
    }),
  );
}

// Forgets the routine's message.
export async function clearRoutineMessage(db: ServerDatabase, routineId: string): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_message_id = NULL, last_message_at = NULL
        WHERE id = ${routineId}`;
    }),
  );
}

// Forgets the routine holding this message id, so a gone message is never edited later.
export async function clearRoutineMessageByTarget(
  db: ServerDatabase,
  messageId: string,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE routines
        SET last_message_id = NULL, last_message_at = NULL
        WHERE last_message_id = ${messageId}`;
    }),
  );
}
