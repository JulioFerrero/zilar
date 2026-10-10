// Whole-chat memory state: the room-memory delete and "clear memory". Split
// out of `agents/memory/store.ts` unchanged (T-1025).

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';

// T-0442: removing an AI from a room deletes that room's memory at once
// (plan §3.5). A room's chat key is `room:<localpart>@<muc domain>`; the
// prefix before the `@` identifies the room, so this covers the room however
// its domain is spelled. Rows of other AIs and other chats (DMs, other rooms)
// stay. The caller passes a room list only, and the delete is scoped to the
// one AI.
//
// T-0666: the delete runs on effect/sql, in the order messages, nodes, facts,
// state.
export function deleteRoomMemoryEffect(
  aiId: string,
  roomLocalparts: string[],
): Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const prefixes = [...new Set(roomLocalparts)].map((localpart) => `room:${localpart}`);
    if (prefixes.length === 0) {
      return;
    }
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DELETE FROM ai_memory_messages
      WHERE ai_id = ${aiId} AND split_part(chat_key, '@', 1) IN ${sql.in(prefixes)}`;
    yield* sql`DELETE FROM ai_memory_nodes
      WHERE ai_id = ${aiId} AND split_part(chat_key, '@', 1) IN ${sql.in(prefixes)}`;
    yield* sql`DELETE FROM ai_memory_facts
      WHERE ai_id = ${aiId} AND split_part(chat_key, '@', 1) IN ${sql.in(prefixes)}`;
    yield* sql`DELETE FROM ai_memory_state
      WHERE ai_id = ${aiId} AND split_part(chat_key, '@', 1) IN ${sql.in(prefixes)}`;
  });
}

// "Clear memory": forget every node and fact of the chat and move the floor to
// the end, so the old messages are never summarised again. The mirror itself
// stays for recall and the recent window.
export async function clearMemory(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<{ maxSeq: number | null }>`SELECT max(seq) AS max_seq
            FROM ai_memory_messages WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
          const maxSeq = row?.maxSeq;
          const total = maxSeq === null || maxSeq === undefined ? 0 : Number(maxSeq) + 1;

          yield* sql`DELETE FROM ai_memory_nodes
            WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
          yield* sql`DELETE FROM ai_memory_facts
            WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
          yield* sql`INSERT INTO ai_memory_state (ai_id, chat_key, floor_seq)
            VALUES (${aiId}, ${chatKey}, ${total})
            ON CONFLICT (ai_id, chat_key)
            DO UPDATE SET floor_seq = ${total}, updated_at = ${new Date().toISOString()}`;
        }),
      );
    }),
  );
}
