import { describe, expect, it } from 'vitest';
import { describeRoutineSchedule, pausedReasonText, truncateOutput } from './routines';

describe('describeRoutineSchedule (T-0107)', () => {
  it('words an hourly interval', () => {
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 60 })).toBe('every 1 hour');
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 360 })).toBe('every 6 hours');
  });

  it('words daily and multi-day intervals', () => {
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 1440 })).toBe('every 1 day');
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 10080 })).toBe('every 7 days');
  });

  it('words a minute interval that is not a whole hour', () => {
    // The server's helper has the same branch (`every N minute(s)`); the
    // minimum is hourly in practice, but the wording covers any value.
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 90 })).toBe(
      'every 90 minutes',
    );
  });

  it('words a daily schedule with all days', () => {
    expect(
      describeRoutineSchedule({ kind: 'daily', time: '09:00', timezone: 'Europe/Madrid' }),
    ).toBe('daily at 09:00 Europe/Madrid');
  });

  it('words a daily schedule with weekdays', () => {
    expect(
      describeRoutineSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [5, 1, 3],
      }),
    ).toBe('daily at 09:00 Europe/Madrid on Mon, Wed, Fri');
  });

  it('falls back to plain words for unknown shapes', () => {
    expect(describeRoutineSchedule(null)).toBe('on a schedule');
    expect(describeRoutineSchedule({ kind: 'weekly' })).toBe('on a schedule');
    expect(
      describeRoutineSchedule({ kind: 'daily', time: '25:00', timezone: 'Europe/Madrid' }),
    ).toBe('on a schedule');
    expect(describeRoutineSchedule({ kind: 'daily', time: '09:00', timezone: '' })).toBe(
      'on a schedule',
    );
    expect(describeRoutineSchedule({ kind: 'interval', everyMinutes: 30 })).toBe('on a schedule');
  });
});

describe('pausedReasonText (T-0107)', () => {
  it('explains each paused reason with its next step', () => {
    expect(pausedReasonText('user', 'paused')).toBe('Paused by a person.');
    expect(pausedReasonText('failures', 'paused')).toContain('Ask the AI to fix it.');
    expect(pausedReasonText('hosts_changed', 'paused')).toContain(
      'Ask the AI to schedule it again',
    );
    expect(pausedReasonText(null, 'needs_approval')).toContain('Ask the AI to schedule it again');
    expect(pausedReasonText(null, 'active')).toBeNull();
  });
});

describe('truncateOutput (T-0107)', () => {
  it('keeps short output whole and cuts long output', () => {
    expect(truncateOutput('ok')).toEqual({ preview: 'ok', truncated: false });
    const long = `x${'y'.repeat(3000)}`;
    const cut = truncateOutput(long);
    expect(cut.truncated).toBe(true);
    expect(cut.preview.endsWith('…')).toBe(true);
    expect(cut.preview.length).toBeLessThan(long.length);
  });
});
