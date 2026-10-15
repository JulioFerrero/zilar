import { describe, expect, it } from 'vitest';
import { formatClock } from './format-duration';

describe('formatClock', () => {
  it('formats a duration as m:ss, minutes never rolling into hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(48_000)).toBe('0:48');
    expect(formatClock(252_000)).toBe('4:12');
    expect(formatClock(3_665_000)).toBe('61:05');
  });
});
