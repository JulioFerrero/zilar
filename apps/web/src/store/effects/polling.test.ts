import { describe, expect, it } from 'vitest';
import { FINISHED_TURNS_MAX } from './constants';
import type { StoreCtx } from './ctx';
import { clearFinishedTurns, markTurnFinished, withoutDraft } from './polling';

function turnsCtx(): StoreCtx {
  return { finishedTurns: new Set<string>(), finishedTurnOrder: [] as string[] } as StoreCtx;
}

describe('draft turn bookkeeping', () => {
  it('remembers at most FINISHED_TURNS_MAX turns, oldest dropped first', () => {
    const ctx = turnsCtx();
    for (let index = 0; index < FINISHED_TURNS_MAX + 5; index += 1) {
      markTurnFinished(ctx, `turn-${index}`);
    }
    expect(ctx.finishedTurns.size).toBe(FINISHED_TURNS_MAX);
    expect(ctx.finishedTurns.has('turn-0')).toBe(false);
    expect(ctx.finishedTurns.has(`turn-${FINISHED_TURNS_MAX + 4}`)).toBe(true);
  });

  it('marking a turn twice keeps one entry, and clearing empties both lists', () => {
    const ctx = turnsCtx();
    markTurnFinished(ctx, 'a');
    markTurnFinished(ctx, 'a');
    expect(ctx.finishedTurnOrder).toEqual(['a']);
    clearFinishedTurns(ctx);
    expect(ctx.finishedTurns.size).toBe(0);
    expect(ctx.finishedTurnOrder).toEqual([]);
  });

  it('withoutDraft returns the same object when there is nothing to drop', () => {
    const drafts = { a: { turnId: 't', text: 'x' } };
    expect(withoutDraft(drafts, 'missing')).toBe(drafts);
    expect(withoutDraft(drafts, 'a')).toEqual({});
    expect(drafts).toEqual({ a: { turnId: 't', text: 'x' } });
  });
});
