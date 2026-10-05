import { describe, expect, it } from 'vitest';
import { expiresInText, expiryParts, worstCaseText } from './formatRelative';

const now = new Date('2026-09-29T10:00:00.000Z');

describe('expiresInText', () => {
  it('returns "Expired" when the deadline has passed', () => {
    expect(expiresInText('2026-09-29T09:59:59.000Z', now)).toBe('Expired');
  });

  it('returns "in N sec" for sub-minute windows', () => {
    expect(expiresInText('2026-09-29T10:00:45.000Z', now)).toBe('in 45 sec');
  });

  it('returns "in N min" for sub-hour windows', () => {
    expect(expiresInText('2026-09-29T10:12:00.000Z', now)).toBe('in 12 min');
  });

  it('returns "in 1 hour" (singular) for exactly one hour', () => {
    expect(expiresInText('2026-09-29T11:00:00.000Z', now)).toBe('in 1 hour');
  });

  it('returns "in N hours" for multi-hour windows', () => {
    expect(expiresInText('2026-09-29T13:00:00.000Z', now)).toBe('in 3 hours');
  });

  it('returns "in 1 day" (singular) for exactly one day', () => {
    expect(expiresInText('2026-09-30T10:00:00.000Z', now)).toBe('in 1 day');
  });

  it('returns "in N days" for multi-day windows', () => {
    expect(expiresInText('2026-10-01T10:00:00.000Z', now)).toBe('in 2 days');
  });
});

describe('expiryParts', () => {
  it('computes the remaining milliseconds and floored seconds', () => {
    const parts = expiryParts('2026-09-29T10:00:45.000Z', now);
    expect(parts.totalMs).toBe(45_000);
    expect(parts.totalSeconds).toBe(45);
  });

  it('clamps a past deadline to zero seconds', () => {
    const parts = expiryParts('2026-09-29T09:00:00.000Z', now);
    expect(parts.totalMs).toBe(-3_600_000);
    expect(parts.totalSeconds).toBe(0);
  });
});

describe('worstCaseText', () => {
  it('formats a EUR amount with the currency symbol', () => {
    expect(worstCaseText({ currency: 'EUR', amount: 0.4 })).toBe('Worst case: €0.40');
  });

  it('returns the empty string for null', () => {
    expect(worstCaseText(null)).toBe('');
  });
});
