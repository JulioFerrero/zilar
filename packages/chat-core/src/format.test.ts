import { describe, expect, it } from 'vitest';
import {
  formatDateSeparator,
  formatDuration,
  formatFullDateTime,
  formatListTime,
  formatTime,
} from './format';

const NOW = new Date(2026, 8, 27, 12, 0); // Sunday 27 September 2026, local time.

describe('formatTime', () => {
  it('pads hours and minutes', () => {
    expect(formatTime(new Date(2026, 8, 27, 8, 5))).toBe('08:05');
    expect(formatTime(new Date(2026, 8, 27, 23, 59))).toBe('23:59');
    expect(formatTime(new Date(2026, 8, 27, 0, 0))).toBe('00:00');
  });
});

describe('formatListTime', () => {
  it('shows the wall clock time for today', () => {
    expect(formatListTime(new Date(2026, 8, 27, 8, 5), NOW)).toBe('08:05');
  });

  it('shows the wall clock time just after midnight', () => {
    const now = new Date(2026, 8, 27, 0, 5);
    expect(formatListTime(new Date(2026, 8, 27, 0, 0), now)).toBe('00:00');
  });

  it('shows the short weekday within the last seven days', () => {
    expect(formatListTime(new Date(2026, 8, 26, 23, 59), NOW)).toBe('Sat');
    expect(formatListTime(new Date(2026, 8, 21, 10, 0), NOW)).toBe('Mon');
  });

  it('crosses midnight as yesterday, not today', () => {
    const now = new Date(2026, 8, 27, 0, 5);
    expect(formatListTime(new Date(2026, 8, 26, 23, 59), now)).toBe('Sat');
  });

  it('shows dd.MM.yy at seven days and older', () => {
    expect(formatListTime(new Date(2026, 8, 20, 10, 0), NOW)).toBe('20.09.26');
    expect(formatListTime(new Date(2026, 7, 1, 10, 0), NOW)).toBe('01.08.26');
  });

  it('keeps the correct year across a year change', () => {
    expect(formatListTime(new Date(2025, 11, 20, 10, 0), NOW)).toBe('20.12.25');
  });
});

describe('formatDateSeparator', () => {
  it('labels today', () => {
    expect(formatDateSeparator(new Date(2026, 8, 27, 0, 1), NOW)).toBe('Today');
  });

  it('labels yesterday', () => {
    expect(formatDateSeparator(new Date(2026, 8, 26, 23, 59), NOW)).toBe('Yesterday');
  });

  it('falls back to month and day in en', () => {
    expect(formatDateSeparator(new Date(2026, 8, 25, 10, 0), NOW)).toBe('September 25');
    expect(formatDateSeparator(new Date(2025, 8, 25, 10, 0), NOW)).toBe('September 25');
  });
});

describe('formatDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1_000)).toBe('0:01');
    expect(formatDuration(12_000)).toBe('0:12');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_600_000)).toBe('60:00');
  });
});

describe('formatFullDateTime', () => {
  it('includes the full date and the clock time', () => {
    const formatted = formatFullDateTime(new Date(2026, 8, 27, 12, 41));
    expect(formatted).toContain('2026');
    expect(formatted).toContain('12:41');
  });
});
