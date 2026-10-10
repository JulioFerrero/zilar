// effect-plain: moved unchanged from apps/server/src/agents/memory/store.ts (size split)
// The system-prompt memory block: resolves the floor and the budget into cover
// blocks and renders them oldest-first. Split out of `agents/memory/store.ts`
// unchanged (T-1025).

import type { ServerDatabase } from '../../db/client';
import { MEMORY_MIN_BLOCK, MEMORY_WAKE_LINES, cover, type Block } from './tree';
import {
  blockKey,
  formatRow,
  halves,
  loadNodeMap,
  loadRows,
  loadSingle,
  memoryRange,
} from './mirror';

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
