// The database helpers the gateway (M3) and the routes (M4) call for one AI's
// long-term memory (T-0438, docs/audit/ai-memory-plan.md §3.3-§3.7). Every
// function is scoped to one (AI, chat) pair and never logs text. The pure tree
// logic lives in `./tree.ts`; this file only reads and writes the mirror, the
// summary nodes and the facts.
//
// Every query runs on the `effect/sql` client registered for this database
// (see `../../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.

import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError, type Statement } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import {
  type Block,
  MEMORY_LINE_MAX,
  MEMORY_MIN_BLOCK,
  MEMORY_WAKE_LINES,
  cover,
  parseBlockId,
  pending,
} from './tree';

// The gateway shows this many recent messages verbatim, so memory only covers
// messages older than the window.
export const MEMORY_WINDOW = 50;

export const MEMORY_FACTS_MAX = 50;

export const MEMORY_RECALL_MAX = 30;

export interface MemoryRange {
  total: number;
  floor: number;
  end: number;
}

export interface MemoryFact {
  id: string;
  text: string;
}

interface MemoryRow {
  seq: number;
  at: Date;
  sender: string;
  text: string;
  deleted: boolean;
}

// A query runs through the runtime registered for this database, exactly like
// the other converted modules; the exported functions stay `async`.
function blockKey(block: Block): string {
  return `${block.lo}-${block.hi}`;
}

function halves(block: Block): [Block, Block] {
  const mid = (block.lo + block.hi) / 2;
  return [
    { lo: block.lo, hi: mid },
    { lo: mid, hi: block.hi },
  ];
}

function formatDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function formatRow(row: Pick<MemoryRow, 'seq' | 'at' | 'sender' | 'text'>): string {
  return `#${row.seq} ${formatDate(row.at)} ${row.sender}: ${row.text}`;
}

async function readFloor(db: ServerDatabase, aiId: string, chatKey: string): Promise<number> {
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

// Drop or split the cover blocks that sit below `floor`: a block fully below it
// disappears, a block that straddles it is opened into its halves until none
// straddle. The result still covers `[floor, end)` with valid pieces.
function resolveFloor(blocks: Block[], floor: number): Block[] {
  const result: Block[] = [];
  const stack = [...blocks].reverse();
  while (stack.length > 0) {
    const block = stack.pop();
    if (block === undefined) continue;
    if (block.hi <= floor) continue;
    if (block.lo >= floor) {
      result.push(block);
      continue;
    }
    const [left, right] = halves(block);
    stack.push(right, left);
  }
  return result;
}

interface RenderContext {
  db: ServerDatabase;
  aiId: string;
  chatKey: string;
  nodes: Map<string, string>;
  budget: number;
  lines: string[];
}

async function loadRows(
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

async function loadSingle(
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

async function loadNodeMap(
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

// Fill `ctx.lines` newest-first from one block, stopping once the budget is
// reached. A missing node is opened into its halves recursively; a size-16
// block without a node becomes its raw rows.
async function collectBlock(ctx: RenderContext, block: Block): Promise<void> {
  if (ctx.lines.length >= ctx.budget) return;
  const size = block.hi - block.lo;
  if (size === 1) {
    const row = await loadSingle(ctx.db, ctx.aiId, ctx.chatKey, block.lo);
    if (row !== undefined && !row.deleted) ctx.lines.push(formatRow(row));
    return;
  }
  const summary = ctx.nodes.get(blockKey(block));
  if (summary !== undefined) {
    ctx.lines.push(`#${block.lo}-${block.hi - 1} ${summary}`);
    return;
  }
  if (size === MEMORY_MIN_BLOCK) {
    const rows = await loadRows(ctx.db, ctx.aiId, ctx.chatKey, block);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row === undefined || row.deleted) continue;
      ctx.lines.push(formatRow(row));
      if (ctx.lines.length >= ctx.budget) return;
    }
    return;
  }
  const [left, right] = halves(block);
  await collectBlock(ctx, right);
  await collectBlock(ctx, left);
}

// The memory block for the system prompt: the oldest-first lines covering
// `[floor, end)`, up to `budget` of them. It never goes over the budget and
// keeps the newest lines, so the recent past survives.
export async function renderMemoryBlock(
  db: ServerDatabase,
  aiId: string,
  chatKey: string,
  budget = MEMORY_WAKE_LINES,
): Promise<string[]> {
  const { end, floor } = await memoryRange(db, aiId, chatKey);
  if (end <= floor) return [];
  const blocks = resolveFloor(cover(end, budget), floor);
  const ctx: RenderContext = {
    db,
    aiId,
    chatKey,
    nodes: await loadNodeMap(db, aiId, chatKey),
    budget,
    lines: [],
  };
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block === undefined) break;
    await collectBlock(ctx, block);
  }
  const newest = ctx.lines.slice(0, budget);
  newest.reverse();
  return newest;
}

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
