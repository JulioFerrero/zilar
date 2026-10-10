// The mirror reads the memory modules share: the (AI, chat) range and the raw
// message and summary-node loads. Split out of `agents/memory/store.ts`
// unchanged (T-1025).

import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { type Block } from './tree';

// The gateway shows this many recent messages verbatim, so memory only covers
// messages older than the window.
export const MEMORY_WINDOW = 50;

export interface MemoryRange {
  total: number;
  floor: number;
  end: number;
}

export interface MemoryRow {
  seq: number;
  at: Date;
  sender: string;
  text: string;
  deleted: boolean;
}

// A query runs through the runtime registered for this database, exactly like
// the other converted modules; the exported functions stay `async`.
export function blockKey(block: Block): string {
  return `${block.lo}-${block.hi}`;
}

export function halves(block: Block): [Block, Block] {
  const mid = (block.lo + block.hi) / 2;
  return [
    { lo: block.lo, hi: mid },
    { lo: mid, hi: block.hi },
  ];
}

function formatDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function formatRow(row: Pick<MemoryRow, 'seq' | 'at' | 'sender' | 'text'>): string {
  return `#${row.seq} ${formatDate(row.at)} ${row.sender}: ${row.text}`;
}

export async function readFloor(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
): Promise<number> {
  const [state] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ floorSeq: number }>`SELECT floor_seq FROM ai_memory_state
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey} LIMIT 1`;
    }),
  );
  return state?.floorSeq ?? 0;
}

async function readTotal(db: ServerDatabase, aiId: string, chatKey: string): Promise<number> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{
        maxSeq: number | null;
      }>`SELECT max(seq) AS max_seq FROM ai_memory_messages
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
    }),
  );
  const maxSeq = row?.maxSeq;
  return maxSeq === null || maxSeq === undefined ? 0 : Number(maxSeq) + 1;
}

// `total` is one past the newest seq, `floor` is where "clear" left the chat,
// and `end` is the first message still in the verbatim window.
export async function memoryRange(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
): Promise<MemoryRange> {
  const [total, floor] = await Promise.all([
    readTotal(db, aiId, chatKey),
    readFloor(db, aiId, chatKey),
  ]);
  return { total, floor, end: Math.max(floor, total - MEMORY_WINDOW) };
}

export async function loadRows(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  block: Block,
): Promise<MemoryRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MemoryRow>`SELECT seq, at, sender, text, deleted FROM ai_memory_messages
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey}
          AND seq >= ${block.lo} AND seq < ${block.hi}
        ORDER BY seq`;
    }),
  );
  return [...rows];
}

export async function loadSingle(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  seq: number,
): Promise<MemoryRow | undefined> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MemoryRow>`SELECT seq, at, sender, text, deleted FROM ai_memory_messages
        WHERE ai_id = ${aiId} AND chat_key = ${chatKey} AND seq = ${seq} LIMIT 1`;
    }),
  );
  return row;
}

export async function loadNodeMap(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
): Promise<Map<string, string>> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ lo: number; hi: number; summary: string }>`SELECT lo, hi, summary
        FROM ai_memory_nodes WHERE ai_id = ${aiId} AND chat_key = ${chatKey}`;
    }),
  );
  return new Map(rows.map((row) => [blockKey({ lo: row.lo, hi: row.hi }), row.summary]));
}
