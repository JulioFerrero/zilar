// The pure core of long-term memory (T-0433, docs/audit/ai-memory-plan.md §4).
// A re-implementation of OptMem's `cover` and `pending`, adapted so the
// smallest summary block is `MEMORY_MIN_BLOCK` messages instead of two. No
// I/O: the mirror, the nodes table and the gateway build on these functions.

export type Block = { lo: number; hi: number };

export const MEMORY_MIN_BLOCK = 16;

export const MEMORY_WAKE_LINES = 48;

export const MEMORY_LINE_MAX = 280;

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function nextPowerOfTwoAtLeast(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

// The one block rule: split a block into its two halves, unless that would
// create a block bigger than one and smaller than `minBlock`; in that case the
// block shatters into single items. A size of one is always allowed, so a
// size-two block still splits into two singles.
function splitBlock(block: Block, minBlock: number): Block[] {
  const size = block.hi - block.lo;
  const half = size / 2;
  if (half >= minBlock || half === 1) {
    return [
      { lo: block.lo, hi: block.lo + half },
      { lo: block.lo + half, hi: block.hi },
    ];
  }
  const singles: Block[] = [];
  for (let i = block.lo; i < block.hi; i += 1) singles.push({ lo: i, hi: i + 1 });
  return singles;
}

// OptMem's `_cover(T, alpha)`: start from the dyadic root and split a block
// while it is older than its size allows. A block is dropped when it starts at
// or after `total`, so the result covers `[0, total)` exactly.
function coverForAlpha(
  total: number,
  alpha: number,
  minBlock: number,
  limit: number,
): Block[] | null {
  const root = nextPowerOfTwoAtLeast(total);
  const blocks: Block[] = [];
  const stack: Block[] = [{ lo: 0, hi: root }];
  while (stack.length > 0) {
    const block = stack.pop();
    if (block === undefined) break;
    if (block.lo >= total) continue;
    const size = block.hi - block.lo;
    const shouldSplit =
      size > 1 && (size < minBlock || block.hi > total || size > alpha * (total - block.lo));
    if (!shouldSplit) {
      blocks.push(block);
      if (blocks.length > limit) return null;
      continue;
    }
    const children = splitBlock(block, minBlock);
    for (const child of children) stack.push(child);
  }
  blocks.sort((a, b) => a.lo - b.lo);
  return blocks;
}

// The coarsest valid tiling: one block per set bit of `total` at or above
// `minBlock`, plus one single per remaining item. Every other valid tiling is
// a refinement of this one.
function coarsestCover(total: number, minBlock: number): Block[] {
  return coverForAlpha(total, 1, minBlock, Number.POSITIVE_INFINITY) ?? [];
}

// Tile `[0, total)` into at most `budget` blocks, as finely as the budget
// allows and finest at the newest end. `total <= budget` gives every item
// verbatim. Otherwise the finest valid tiling that fits is found by bisecting
// OptMem's `alpha`, and leftover lines are spent splitting the newest block
// that still has room. When even the coarsest valid tiling is over budget
// (small budgets: with `minBlock` 16 and a 15-item tail the coarsest tiling
// alone is past, say, 8 lines), that coarsest tiling is returned as-is rather
// than dropping memory, and the result is over budget by design.
export function cover(total: number, budget: number, minBlock = MEMORY_MIN_BLOCK): Block[] {
  if (total <= 0) return [];
  if (total <= budget) {
    const singles: Block[] = [];
    for (let i = 0; i < total; i += 1) singles.push({ lo: i, hi: i + 1 });
    return singles;
  }

  const coarsest = coarsestCover(total, minBlock);
  if (coarsest.length > budget) return coarsest;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (coverForAlpha(total, mid, minBlock, budget) !== null) high = mid;
    else low = mid;
  }
  const result = coverForAlpha(total, high, minBlock, budget) ?? coarsest;

  for (;;) {
    let target: Block | undefined;
    let index = -1;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      const candidate = result[i];
      if (candidate !== undefined && candidate.hi - candidate.lo > 1) {
        target = candidate;
        index = i;
        break;
      }
    }
    if (target === undefined) break;
    const children = splitBlock(target, minBlock);
    if (result.length - 1 + children.length > budget) break;
    result.splice(index, 1, ...children);
  }
  return result;
}

// The blocks that can be built right now, smallest first: every aligned
// `minBlock` block of the log, then each larger block only once both of its
// halves are built. `built` answers whether a block already exists.
export function pending(
  total: number,
  built: (block: Block) => boolean,
  minBlock = MEMORY_MIN_BLOCK,
): Block[] {
  const result: Block[] = [];
  for (let size = minBlock; size <= total; size *= 2) {
    for (let lo = 0; lo + size <= total; lo += size) {
      const block = { lo, hi: lo + size };
      if (built(block)) continue;
      if (size > minBlock) {
        const half = size / 2;
        if (!built({ lo, hi: lo + half }) || !built({ lo: lo + half, hi: lo + size })) {
          continue;
        }
      }
      result.push(block);
    }
  }
  return result;
}

export function formatBlockId(block: Block): string {
  return `${block.lo}-${block.hi - 1}`;
}

// Read "16-31" (inclusive on both ends) back into a block: an aligned power of
// two at least `minBlock`, or null for anything else. The inverse of
// `formatBlockId` for every block the tree builds.
export function parseBlockId(id: string, minBlock = MEMORY_MIN_BLOCK): Block | null {
  const match = /^(\d+)-(\d+)$/.exec(id);
  if (match === null) return null;
  const lo = Number(match[1]);
  const hiInclusive = Number(match[2]);
  const size = hiInclusive - lo + 1;
  if (size < 2 || size < minBlock || !isPowerOfTwo(size)) return null;
  if (lo % size !== 0) return null;
  return { lo, hi: hiInclusive + 1 };
}
