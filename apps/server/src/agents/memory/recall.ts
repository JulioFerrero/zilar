// Keyword and zoom recall over the mirror. Split out of
// `agents/memory/store.ts` unchanged (T-1025).

import { Effect } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { parseBlockId } from './tree';
import {
  blockKey,
  formatRow,
  halves,
  loadNodeMap,
  loadRows,
  memoryRange,
  readFloor,
  type MemoryRow,
} from './mirror';

export const MEMORY_RECALL_MAX = 30;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

// The newest matches of a keyword search over the mirror, oldest-first, capped
// at `MEMORY_RECALL_MAX` with a count note when more matched. Every word must
// appear, case-insensitively; wildcards in the input are literal, and no input
// ever becomes a regex.
export async function recallMemory(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  query: string,
): Promise<string[]> {
  const words = query
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 8);
  if (words.length === 0) return [];

  const floor = await readFloor(db, aiId, chatKey);
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const conditions: Array<Statement.Fragment> = [
        sql`ai_id = ${aiId}`,
        sql`chat_key = ${chatKey}`,
        sql`deleted = false`,
        sql`seq >= ${floor}`,
        ...words.map((word) => sql`text ILIKE ${`%${escapeLike(word)}%`} ESCAPE '\\'`),
      ];
      const where = sql.and(conditions);

      const [countRow] = yield* sql<{ count: number }>`SELECT count(*)::int AS count
        FROM ai_memory_messages WHERE ${where}`;
      const count = Number(countRow?.count ?? 0);
      if (count === 0) return [];

      const rows = yield* sql<MemoryRow>`SELECT seq, at, sender, text, deleted
        FROM ai_memory_messages WHERE ${where}
        ORDER BY seq DESC LIMIT ${MEMORY_RECALL_MAX}`;

      const lines = [...rows].reverse().map(formatRow);
      if (count > MEMORY_RECALL_MAX) {
        lines.push(`Newest ${MEMORY_RECALL_MAX} of ${count} matches.`);
      }
      return lines;
    }),
  );
}

// Open one summary block into its two halves, each a node summary or its raw
// rows. An id that is malformed, below the floor or past the log is `null`.
export async function zoomMemory(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  blockId: string,
): Promise<string[] | null> {
  const block = parseBlockId(blockId);
  if (block === null) return null;

  const { total, floor } = await memoryRange(db, aiId, chatKey);
  if (block.lo < floor || block.hi > total) return null;

  const nodes = await loadNodeMap(db, aiId, chatKey);
  const lines: string[] = [];
  for (const half of halves(block)) {
    const summary = nodes.get(blockKey(half));
    if (summary !== undefined) {
      lines.push(`#${half.lo}-${half.hi - 1} ${summary}`);
      continue;
    }
    const rows = await loadRows(db, aiId, chatKey, half);
    for (const row of rows) {
      if (!row.deleted) lines.push(formatRow(row));
    }
  }
  return lines;
}
