import { describe, expect, it } from 'vitest';

import {
  formatDateSeparator,
  formatLastSeen,
  formatListTime,
  formatTime,
  formatVoiceDuration,
} from './time';

/** Local time, so the assertions do not depend on the machine's timezone. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

// Sunday.
const NOW = new Date(2026, 8, 27, 15, 0);

describe('formatTime', () => {
  it('pads to HH:mm', () => {
    expect(formatTime(local(2026, 9, 27, 9, 5))).toBe('09:05');
    expect(formatTime(local(2026, 9, 27, 12, 41))).toBe('12:41');
  });
});

describe('formatListTime', () => {
  it('uses the time for today', () => {
    expect(formatListTime(local(2026, 9, 27, 12, 41), NOW)).toBe('12:41');
  });

  it('uses the short weekday within 7 days', () => {
    expect(formatListTime(local(2026, 9, 24, 10, 0), NOW)).toBe('Thu');
    expect(formatListTime(local(2026, 9, 21, 10, 0), NOW)).toBe('Mon');
  });

  it('uses dd.MM.yy from 7 days back', () => {
    expect(formatListTime(local(2026, 9, 20, 10, 0), NOW)).toBe('20.09.26');
    expect(formatListTime(local(2026, 8, 15, 10, 0), NOW)).toBe('15.08.26');
  });

  it('handles a year change', () => {
    expect(formatListTime(local(2025, 12, 31, 23, 59), NOW)).toBe('31.12.25');
  });
});

describe('formatDateSeparator', () => {
  it('names today and yesterday', () => {
    expect(formatDateSeparator(local(2026, 9, 27, 8, 0), NOW)).toBe('Today');
    expect(formatDateSeparator(local(2026, 9, 26, 23, 30), NOW)).toBe('Yesterday');
  });

  it('uses the month and day inside the same year', () => {
    expect(formatDateSeparator(local(2026, 9, 25, 12, 0), NOW)).toBe('September 25');
  });

  it('adds the year when it differs', () => {
    expect(formatDateSeparator(local(2025, 12, 31, 12, 0), NOW)).toBe('December 31, 2025');
  });
});

describe('formatVoiceDuration', () => {
  it('formats m:ss', () => {
    expect(formatVoiceDuration(12_400)).toBe('0:12');
    expect(formatVoiceDuration(65_000)).toBe('1:05');
    expect(formatVoiceDuration(0)).toBe('0:00');
  });
});

describe('formatLastSeen', () => {
  it('formats minutes, hours and days', () => {
    expect(formatLastSeen(local(2026, 9, 27, 14, 55), NOW)).toBe('last seen 5 minutes ago');
    expect(formatLastSeen(local(2026, 9, 27, 13, 30), NOW)).toBe('last seen 1 hour ago');
    expect(formatLastSeen(local(2026, 9, 26, 22, 0), NOW)).toBe('last seen 17 hours ago');
    expect(formatLastSeen(local(2026, 9, 26, 10, 0), NOW)).toBe('last seen yesterday');
    expect(formatLastSeen(local(2026, 9, 24, 10, 0), NOW)).toBe('last seen 3 days ago');
  });
});
