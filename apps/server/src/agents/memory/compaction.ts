// The compaction feed and the summary-node store. Split out of
// `agents/memory/store.ts` unchanged (T-1025).

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { MEMORY_LINE_MAX, MEMORY_MIN_BLOCK, pending, type Block } from './tree';
import { blockKey, formatRow, halves, loadNodeMap, loadRows, memoryRange } from './mirror';

// The blocks that can be summarised now, smallest first, only above the floor
// and never past `end` (messages still in the window have no tree yet).
export async function pendingNodes(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  limit: number,
): Promise<Block[]> {
  const { end, floor } = await memoryRange(db, aiId, chatKey);
  const built = await loadNodeMap(db, aiId, chatKey);
  return pending(end, (block) => built.has(blockKey(block)))
    .filter((block) => block.lo >= floor)
    .slice(0, limit);
}

// What the compactor feeds the model: the raw rows of a size-16 block (deleted
// rows skipped) or the two summaries of a larger block.
export async function compactionInput(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  block: Block,
): Promise<string[]> {
  const size = block.hi - block.lo;
  if (size === MEMORY_MIN_BLOCK) {
    const rows = await loadRows(db, aiId, chatKey, block);
    return rows.filter((row) => !row.deleted).map(formatRow);
  }

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

// Store one node summary, cut to one line. The cut never leaves a lone high
// surrogate at the end (the string would then be half an astral character). A
// concurrent build wins: a second insert for the same block is dropped.
export async function putNode(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  block: Block,
  summary: string,
): Promise<void> {
  const cut = summary.slice(0, MEMORY_LINE_MAX);
  const value = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO ai_memory_nodes (ai_id, chat_key, lo, hi, summary)
        VALUES (${aiId}, ${chatKey}, ${block.lo}, ${block.hi}, ${value})
        ON CONFLICT DO NOTHING`;
    }),
  );
}

// The pure compaction prompt: the fixed instruction followed by the input
// lines. No text from the chat is formatted here beyond what the caller passes.
export function buildCompactionPrompt(blockId: string, inputLines: string[]): string {
  const header =
    `Compress chat memory #${blockId} into one line of at most ${MEMORY_LINE_MAX} characters. ` +
    'Keep what has lasting effect (decisions, facts, preferences, plans, who said what that ' +
    'matters); drop small talk. Invent nothing. Never include passwords, codes, keys or tokens. ' +
    'Reply with the line only.';
  if (inputLines.length === 0) return header;
  return `${header}\n${inputLines.join('\n')}`;
}
