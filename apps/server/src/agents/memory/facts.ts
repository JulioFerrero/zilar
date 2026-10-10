// Pinned facts for one (AI, chat): list, add under a per-chat lock, delete.
// Split out of `agents/memory/store.ts` unchanged (T-1025).

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { MEMORY_LINE_MAX } from './tree';

export const MEMORY_FACTS_MAX = 50;

export interface MemoryFact {
  id: string;
  text: string;
}

// Pinned facts, oldest first.
export async function listFacts(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
): Promise<MemoryFact[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MemoryFact>`SELECT id, text FROM ai_memory_facts
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey}
        ORDER BY created_at, id`;
    }),
  );
  return [...rows];
}

export type AddFactResult = 'saved' | 'duplicate' | 'invalid';

// Trim and validate a new fact, reject a case-insensitive duplicate, then
// insert and drop the oldest facts past `MEMORY_FACTS_MAX`. The read and the
// write share one transaction under a per-chat advisory lock, so two racing
// adds cannot both pass the duplicate check or overshoot the cap.
export async function addFact(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  text: string,
): Promise<AddFactResult> {
  const value = text.trim();
  if (
    value.length === 0 ||
    value.length > MEMORY_LINE_MAX ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return 'invalid';
  }

  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-memory-facts:${aiId}:${chatKey}`}))`;
          const existing = yield* sql<{ id: string }>`SELECT id FROM ai_memory_facts
            WHERE ai_id = ${aiId} AND chat_key = ${chatKey}
              AND lower(text) = lower(${value}) LIMIT 1`;
          if (existing.length > 0) return 'duplicate' as const;

          yield* sql`INSERT INTO ai_memory_facts (id, ai_id, chat_key, text)
            VALUES (${randomUUID()}, ${aiId}, ${chatKey}, ${value})`;

          const rows = yield* sql<{ id: string }>`SELECT id FROM ai_memory_facts
            WHERE ai_id = ${aiId} AND chat_key = ${chatKey}
            ORDER BY created_at, id`;
          const excess = rows.length - MEMORY_FACTS_MAX;
          if (excess > 0) {
            const oldest = rows.slice(0, excess).map((row) => row.id);
            yield* sql`DELETE FROM ai_memory_facts
              WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND id IN ${sql.in(oldest)}`;
          }
          return 'saved' as const;
        }),
      );
    }),
  );
}

// Delete one fact, scoped to its AI and chat. Returns whether a row was
// removed, so another AI's id reads as a miss.
export async function deleteFact(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  factId: string,
): Promise<boolean> {
  const removed = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string }>`DELETE FROM ai_memory_facts
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND id = ${factId}
        RETURNING id`;
    }),
  );
  return removed.length > 0;
}
