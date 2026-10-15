// T-1611: a turn with the AI's computer on gets computer-sized limits (at
// least 40 rounds plus `COMPUTER_TURN_CAPS`); a turn without the computer
// keeps exactly what the gateway configured. One model call is also capped at
// `MODEL_CALL_MAX_MS`.
import { describe, expect, it } from 'vitest';
import { COMPUTER_TURN_CAPS, MODEL_CALL_MAX_MS } from '../tool-loop';
import { remainingTurnBudgetMs } from '../turn-budget';
import { turnLimits } from './turn-rounds';

describe('turnLimits', () => {
  it('gives a desk turn the computer rounds and caps', () => {
    expect(turnLimits(1, true)).toEqual({ maxRounds: 40, caps: COMPUTER_TURN_CAPS });
  });

  it('keeps a configured value above the computer floor', () => {
    expect(turnLimits(60, true).maxRounds).toBe(60);
  });

  it('leaves a turn without the computer at its configured rounds', () => {
    expect(turnLimits(1, false)).toEqual({ maxRounds: 1 });
  });

  it('leaves an unset turn without the computer unset', () => {
    expect(turnLimits(undefined, false)).toEqual({});
  });
});

describe('remainingTurnBudgetMs', () => {
  it('caps one model call at MODEL_CALL_MAX_MS', () => {
    const start = 1_000;
    expect(remainingTurnBudgetMs(start, () => start, COMPUTER_TURN_CAPS.wallClockMs)).toBe(
      MODEL_CALL_MAX_MS,
    );
  });
});
