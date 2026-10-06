import { describe, expect, it } from 'vitest';
import {
  type Block,
  MEMORY_MIN_BLOCK,
  MEMORY_LINE_MAX,
  MEMORY_WAKE_LINES,
  cover,
  formatBlockId,
  parseBlockId,
  pending,
} from './tree';

const MIN = MEMORY_MIN_BLOCK;

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

// Independent oracle: the number of blocks in the coarsest valid tiling, one
// per set bit of `total` at or above `minBlock` plus one single per remainder.
function coarsestCount(total: number, minBlock: number): number {
  let count = 0;
  let remaining = total;
  for (let size = 1 << 30; size >= 1; size >>= 1) {
    if (size >= minBlock && remaining >= size) {
      count += 1;
      remaining -= size;
    }
  }
  return count + remaining;
}

function expectValidTiling(blocks: Block[], total: number, minBlock = MIN): void {
  expect(blocks.length).toBeGreaterThan(0);
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (first === undefined || last === undefined) throw new Error('empty cover');
  expect(first.lo).toBe(0);
  expect(last.hi).toBe(total);
  let previousHi = -1;
  for (const block of blocks) {
    const size = block.hi - block.lo;
    expect(size).toBeGreaterThan(0);
    expect(isPowerOfTwo(size)).toBe(true);
    expect(size === 1 || size >= minBlock).toBe(true);
    expect(block.lo % size).toBe(0);
    if (previousHi >= 0) expect(block.lo).toBe(previousHi);
    previousHi = block.hi;
  }
}

describe('cover', () => {
  it('gives every item verbatim when the total fits the budget', () => {
    expect(cover(0, 48)).toEqual([]);
    for (let total = 1; total <= 96; total += 1) {
      const blocks = cover(total, 96);
      expect(blocks).toHaveLength(total);
      expect(blocks).toEqual(Array.from({ length: total }, (_, i) => ({ lo: i, hi: i + 1 })));
    }
  });

  it('never goes over the budget unless the coarsest tiling cannot fit', () => {
    for (let total = 1; total <= 2000; total += 1) {
      for (const budget of [8, 48, 96]) {
        const blocks = cover(total, budget);
        const coarsest = coarsestCount(total, MIN);
        if (coarsest <= budget) {
          expect(blocks.length).toBeLessThanOrEqual(budget);
        } else {
          expect(blocks.length).toBe(coarsest);
        }
      }
    }
  });

  it('covers [0,total) exactly, contiguously, with valid aligned blocks', () => {
    for (let total = 1; total <= 2000; total += 1) {
      for (const budget of [8, 48, 96]) {
        const blocks = cover(total, budget);
        expectValidTiling(blocks, total);
      }
    }
  });

  it('keeps the last block the finest: block size never grows toward the end', () => {
    for (let total = 1; total <= 2000; total += 1) {
      for (const budget of [8, 48, 96]) {
        const blocks = cover(total, budget);
        let previousSize = Number.POSITIVE_INFINITY;
        for (const block of blocks) {
          const current = block.hi - block.lo;
          expect(current).toBeLessThanOrEqual(previousSize);
          previousSize = current;
        }
      }
    }
  });

  it('spends the budget on the newest blocks when it can', () => {
    const blocks = cover(500, 48);
    expect(blocks.length).toBeLessThanOrEqual(48);
    const last = blocks[blocks.length - 1];
    expect(last).toBeDefined();
    expect((last?.hi ?? 0) - (last?.lo ?? 0)).toBe(1);
  });

  it('exposes the plan constants', () => {
    expect(MEMORY_MIN_BLOCK).toBe(16);
    expect(MEMORY_WAKE_LINES).toBe(48);
    expect(MEMORY_LINE_MAX).toBe(280);
  });
});

describe('pending', () => {
  it('lists whole minBlock blocks first when nothing is built', () => {
    expect(pending(64, () => false)).toEqual([
      { lo: 0, hi: 16 },
      { lo: 16, hi: 32 },
      { lo: 32, hi: 48 },
      { lo: 48, hi: 64 },
    ]);
  });

  it('does not list a parent until both halves are built', () => {
    const built = new Set<string>();
    const isBuilt = (block: Block) => built.has(formatBlockId(block));

    expect(pending(64, isBuilt).map(formatBlockId)).toEqual(['0-15', '16-31', '32-47', '48-63']);

    built.add('0-15');
    expect(pending(64, isBuilt).map(formatBlockId)).toEqual(['16-31', '32-47', '48-63']);

    built.add('16-31');
    const afterFirstPair = pending(64, isBuilt).map(formatBlockId);
    expect(afterFirstPair).toContain('0-31');
    expect(afterFirstPair).not.toContain('32-63');
  });

  it('lists smallest size first across levels', () => {
    const built = new Set<string>();
    for (const id of ['0-15', '16-31', '32-47', '48-63']) built.add(id);
    const blocks = pending(64, (block) => built.has(formatBlockId(block)));
    expect(blocks.map(formatBlockId)).toEqual(['0-31', '32-63']);
    let previousSize = 0;
    for (const block of blocks) {
      const size = block.hi - block.lo;
      expect(size).toBeGreaterThanOrEqual(previousSize);
      previousSize = size;
    }
  });
});

describe('block ids', () => {
  it('round-trips through formatBlockId and parseBlockId', () => {
    for (const block of [
      { lo: 0, hi: 16 },
      { lo: 16, hi: 32 },
      { lo: 64, hi: 80 },
      { lo: 1024, hi: 2048 },
    ]) {
      expect(parseBlockId(formatBlockId(block))).toEqual(block);
    }
  });

  it('reads "16-31" as the inclusive block [16,32)', () => {
    expect(parseBlockId('16-31')).toEqual({ lo: 16, hi: 32 });
    expect(parseBlockId('0-15')).toEqual({ lo: 0, hi: 16 });
  });

  it('rejects blocks below the minimum, unaligned blocks and junk', () => {
    expect(parseBlockId('4-5', 16)).toBeNull();
    expect(parseBlockId('4-5')).toBeNull();
    expect(parseBlockId('5-6')).toBeNull();
    expect(parseBlockId('3-10')).toBeNull();
    expect(parseBlockId('16-30')).toBeNull();
    expect(parseBlockId('17-32')).toBeNull();
    expect(parseBlockId('')).toBeNull();
    expect(parseBlockId('junk')).toBeNull();
    expect(parseBlockId('16_31')).toBeNull();
  });

  it('accepts a smaller minimum when asked', () => {
    expect(parseBlockId('4-5', 2)).toEqual({ lo: 4, hi: 6 });
  });
});
