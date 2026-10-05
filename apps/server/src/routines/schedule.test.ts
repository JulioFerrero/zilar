import { describe, expect, it } from 'vitest';
import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  nextRunAfter,
  parseRoutineSchedule,
  type RoutineSchedule,
} from './schedule';

const date = (iso: string): Date => new Date(iso);

function daily(time: string, timezone: string, weekdays?: number[]): RoutineSchedule {
  return {
    kind: 'daily',
    time,
    timezone,
    weekdays: weekdays ?? [1, 2, 3, 4, 5, 6, 7],
  };
}

describe('parseRoutineSchedule', () => {
  it('accepts a daily schedule and defaults weekdays to every day', () => {
    const parsed = parseRoutineSchedule({
      kind: 'daily',
      time: '09:00',
      timezone: 'Europe/Madrid',
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
      },
    });
  });

  it('accepts an interval schedule', () => {
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 60 })).toEqual({
      ok: true,
      value: { kind: 'interval', everyMinutes: 60 },
    });
  });

  it('rejects an unknown time zone', () => {
    const parsed = parseRoutineSchedule({
      kind: 'daily',
      time: '09:00',
      timezone: 'Mars/Olympus',
    });
    expect(parsed.ok).toBe(false);
  });

  it('rejects 25:00, 9:00 and other malformed times', () => {
    for (const time of ['25:00', '9:00', '09:0', '0900', '12:60', '']) {
      const parsed = parseRoutineSchedule({ kind: 'daily', time, timezone: 'Europe/Madrid' });
      expect(parsed.ok, time).toBe(false);
    }
  });

  it('accepts the midnight and end-of-day boundaries', () => {
    expect(
      parseRoutineSchedule({ kind: 'daily', time: '00:00', timezone: 'Europe/Madrid' }).ok,
    ).toBe(true);
    expect(
      parseRoutineSchedule({ kind: 'daily', time: '23:59', timezone: 'Europe/Madrid' }).ok,
    ).toBe(true);
  });

  it('rejects empty weekdays and duplicate weekdays', () => {
    expect(
      parseRoutineSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [],
      }).ok,
    ).toBe(false);
    expect(
      parseRoutineSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [1, 1],
      }).ok,
    ).toBe(false);
    expect(
      parseRoutineSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [0],
      }).ok,
    ).toBe(false);
    expect(
      parseRoutineSchedule({
        kind: 'daily',
        time: '09:00',
        timezone: 'Europe/Madrid',
        weekdays: [8],
      }).ok,
    ).toBe(false);
  });

  it(`rejects intervals below ${MIN_INTERVAL_MINUTES} and above ${MAX_INTERVAL_MINUTES}`, () => {
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 59 }).ok).toBe(false);
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 1 }).ok).toBe(false);
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 10_081 }).ok).toBe(false);
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 90.5 }).ok).toBe(false);
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 10_080 }).ok).toBe(true);
  });

  it('rejects unknown shapes and extra keys', () => {
    expect(parseRoutineSchedule({ kind: 'cron', expr: '* * * * *' }).ok).toBe(false);
    expect(parseRoutineSchedule({ kind: 'interval', everyMinutes: 60, jitter: 5 }).ok).toBe(false);
    expect(parseRoutineSchedule(null).ok).toBe(false);
  });
});

describe('nextRunAfter (interval)', () => {
  it('returns the next boundary strictly after `from`', () => {
    expect(
      nextRunAfter({ kind: 'interval', everyMinutes: 60 }, date('2026-01-01T00:00:01Z')),
    ).toEqual(date('2026-01-01T01:00:00Z'));
  });

  it('moves past an exact boundary', () => {
    expect(
      nextRunAfter({ kind: 'interval', everyMinutes: 60 }, date('2026-01-01T01:00:00Z')),
    ).toEqual(date('2026-01-01T02:00:00Z'));
  });

  it('supports multi-day intervals', () => {
    expect(
      nextRunAfter({ kind: 'interval', everyMinutes: 10_080 }, date('2026-01-01T00:00:00Z')),
    ).toEqual(date('2026-01-08T00:00:00Z'));
  });
});

describe('nextRunAfter (daily)', () => {
  it('fires later the same day when the time has not passed', () => {
    // 2026-06-01 is a Monday; 09:00 CEST = 07:00Z.
    expect(daily('09:00', 'Europe/Madrid')).toBeDefined();
    expect(nextRunAfter(daily('09:00', 'Europe/Madrid'), date('2026-06-01T05:00:00Z'))).toEqual(
      date('2026-06-01T07:00:00Z'),
    );
  });

  it('fires the next day when the time already passed', () => {
    expect(nextRunAfter(daily('09:00', 'Europe/Madrid'), date('2026-06-01T12:00:00Z'))).toEqual(
      date('2026-06-02T07:00:00Z'),
    );
  });

  it('is strictly after `from`, even at the exact occurrence', () => {
    expect(nextRunAfter(daily('09:00', 'Europe/Madrid'), date('2026-06-01T07:00:00Z'))).toEqual(
      date('2026-06-02T07:00:00Z'),
    );
  });

  it('honours weekdays filtering (Monday = 1)', () => {
    // 2026-06-01 is a Monday; weekdays [5] = Friday only → 2026-06-05 09:00 CEST.
    expect(
      nextRunAfter(daily('09:00', 'Europe/Madrid', [5]), date('2026-06-01T05:00:00Z')),
    ).toEqual(date('2026-06-05T07:00:00Z'));
  });

  it('skips to next week when today is the only selected day and it passed', () => {
    // Monday 2026-06-01 12:00Z, weekdays [1]: next Monday 09:00 CEST.
    expect(
      nextRunAfter(daily('09:00', 'Europe/Madrid', [1]), date('2026-06-01T12:00:00Z')),
    ).toEqual(date('2026-06-08T07:00:00Z'));
  });

  it('rolls over month and year boundaries', () => {
    // 09:00 CET = 08:00Z.
    expect(nextRunAfter(daily('09:00', 'Europe/Madrid'), date('2025-12-31T12:00:00Z'))).toEqual(
      date('2026-01-01T08:00:00Z'),
    );
    expect(nextRunAfter(daily('09:00', 'Europe/Madrid'), date('2026-01-31T12:00:00Z'))).toEqual(
      date('2026-02-01T08:00:00Z'),
    );
  });

  it('Madrid spring forward: 02:30 runs at 03:00 CEST', () => {
    // DST starts 2026-03-29 02:00 CET → 03:00 CEST. 02:30 does not exist;
    // first valid moment is 03:00 CEST = 01:00Z.
    expect(nextRunAfter(daily('02:30', 'Europe/Madrid'), date('2026-03-28T12:00:00Z'))).toEqual(
      date('2026-03-29T01:00:00Z'),
    );
  });

  it('New York spring forward: 02:30 runs at 03:00 EDT', () => {
    // DST starts 2026-03-08 02:00 EST → 03:00 EDT. 02:30 does not exist;
    // first valid moment is 03:00 EDT = 07:00Z.
    expect(nextRunAfter(daily('02:30', 'America/New_York'), date('2026-03-07T12:00:00Z'))).toEqual(
      date('2026-03-08T07:00:00Z'),
    );
  });

  it('Madrid fall back: 02:30 runs once, at the first occurrence', () => {
    // DST ends 2026-10-25 03:00 CEST → 02:00 CET. 02:30 happens twice;
    // the first is 02:30 CEST = 00:30Z.
    expect(nextRunAfter(daily('02:30', 'Europe/Madrid'), date('2026-10-24T12:00:00Z'))).toEqual(
      date('2026-10-25T00:30:00Z'),
    );
  });

  it('New York fall back: 01:30 runs once, at the first occurrence', () => {
    // DST ends 2026-11-01 02:00 EDT → 01:00 EST. 01:30 happens twice;
    // the first is 01:30 EDT = 05:30Z.
    expect(nextRunAfter(daily('01:30', 'America/New_York'), date('2026-10-31T12:00:00Z'))).toEqual(
      date('2026-11-01T05:30:00Z'),
    );
  });

  it('a normal time on a transition day is unaffected', () => {
    // 09:00 CEST on Madrid spring-forward day = 07:00Z.
    expect(nextRunAfter(daily('09:00', 'Europe/Madrid'), date('2026-03-28T12:00:00Z'))).toEqual(
      date('2026-03-29T07:00:00Z'),
    );
    // 09:00 EDT on 10-31 is still ahead (13:00Z), so ask from after it:
    // 09:00 EST on the fall-back day 11-01 = 14:00Z.
    expect(nextRunAfter(daily('09:00', 'America/New_York'), date('2026-10-31T14:00:00Z'))).toEqual(
      date('2026-11-01T14:00:00Z'),
    );
  });
});
