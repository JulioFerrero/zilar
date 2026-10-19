import { describe, expect, it } from 'vitest';
import { aiHealth, formatUsd, spendFraction } from './ai';

const active = { status: 'active', limits: { perDayUsd: null } };

describe('aiHealth', () => {
  it('works when the AI is active and healthy', () => {
    expect(aiHealth(active)).toEqual({ state: 'working' });
  });

  it('is stopped when the status is not active', () => {
    expect(aiHealth({ ...active, status: 'stopped' })).toEqual({ state: 'stopped' });
    expect(aiHealth({ ...active, status: 'disabled' })).toEqual({ state: 'stopped' });
    // The stopped state wins over a logged failure.
    expect(
      aiHealth({ ...active, status: 'stopped', lastFailure: { kind: 'key_rejected' } }),
    ).toEqual({ state: 'stopped' });
  });

  it('is paused when today reached the daily limit', () => {
    expect(aiHealth({ ...active, limits: { perDayUsd: 2 }, usage: { todayUsd: 2 } })).toEqual({
      state: 'paused',
    });
  });

  it('fails with the reason table', () => {
    const reasons: Record<string, string> = {
      key_rejected: 'Key rejected',
      model_not_found: 'Model not found',
      rate_limited: 'Rate limited',
      budget: 'Provider budget reached',
      context_too_long: 'Too much context',
      timeout: 'Timed out',
      something_new: 'Last reply failed',
    };
    for (const [kind, reason] of Object.entries(reasons)) {
      expect(aiHealth({ ...active, lastFailure: { kind } })).toMatchObject({
        state: 'failing',
        reason,
      });
    }
  });

  it('offers the fix only for a rejected key and an unknown model', () => {
    expect(aiHealth({ ...active, lastFailure: { kind: 'key_rejected' } }).fix).toBe('replace_key');
    expect(aiHealth({ ...active, lastFailure: { kind: 'model_not_found' } }).fix).toBe(
      'change_model',
    );
    expect(aiHealth({ ...active, lastFailure: { kind: 'rate_limited' } }).fix).toBeUndefined();
  });

  it('fails over pausing', () => {
    expect(
      aiHealth({
        limits: { perDayUsd: 2 },
        usage: { todayUsd: 3 },
        status: 'active',
        lastFailure: { kind: 'timeout' },
      }),
    ).toEqual({ state: 'failing', reason: 'Timed out' });
  });
});

describe('formatUsd', () => {
  it('always shows two decimals', () => {
    expect(formatUsd(0.42)).toBe('$0.42');
    expect(formatUsd(2)).toBe('$2.00');
  });
});

describe('spendFraction', () => {
  it('is null without a limit or without usage', () => {
    expect(spendFraction(active)).toBeNull();
    expect(spendFraction({ ...active, limits: { perDayUsd: 2 } })).toBeNull();
    expect(spendFraction({ ...active, usage: { todayUsd: 1 } })).toBeNull();
  });

  it('is the share of the daily limit, capped at 1', () => {
    expect(spendFraction({ ...active, limits: { perDayUsd: 2 }, usage: { todayUsd: 0.5 } })).toBe(
      0.25,
    );
    expect(spendFraction({ ...active, limits: { perDayUsd: 2 }, usage: { todayUsd: 3 } })).toBe(1);
  });
});
