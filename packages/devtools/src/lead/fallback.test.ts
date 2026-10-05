import { describe, expect, it } from 'vitest';
import { fallbackModel, FREE_MUSE, PAID_MUSE } from './fallback';

describe('fallbackModel', () => {
  it('maps the free Muse listing to the paid one', () => {
    expect(fallbackModel(FREE_MUSE)).toBe(PAID_MUSE);
  });

  it('returns undefined for the paid listing, MiniMax and empty', () => {
    expect(fallbackModel(PAID_MUSE)).toBeUndefined();
    expect(fallbackModel('minimax-coding-plan/MiniMax-M3')).toBeUndefined();
    expect(fallbackModel('')).toBeUndefined();
  });
});
