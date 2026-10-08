// T-0104: routine schedules. Pure module, no dependencies: time zones go
// through `Intl.DateTimeFormat`, validation through `zod`.
//
// Two shapes:
// - `{ kind: 'daily', time: 'HH:MM', timezone: <IANA name>, weekdays?: number[] }`
//   (1 = Monday … 7 = Sunday, default all days, at least one). The run is a
//   wall-clock time in the zone, correct across daylight-saving changes: a
//   wall time that does not exist (spring forward) runs at the first valid
//   moment after it that day (02:30 becomes 03:00); an ambiguous wall time
//   (fall back) runs once, at the first occurrence.
// - `{ kind: 'interval', everyMinutes: number }` with
//   60 <= everyMinutes <= 10 080: nothing runs more often than hourly.
import { Exit, Schema, SchemaIssue } from 'effect';
import { struct } from '@zilar/protocol';

export const MIN_INTERVAL_MINUTES = 60;
export const MAX_INTERVAL_MINUTES = 10_080;

// Every custom message is a `makeFilter` text: effect 4 drops the
// `{ message }` option on `isMinLength`/`isMaxLength`, but a filter that
// returns the text carries it on the issue annotations.
const timeSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? undefined : 'time must be HH:MM (00:00-23:59)',
  ),
);

const timezoneSchema = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value.length >= 1 ? undefined : 'timezone must not be empty',
  ),
);

const everyMinutesSchema = Schema.Finite.check(
  Schema.makeFilter((value: number) =>
    Number.isInteger(value) ? undefined : 'everyMinutes must be an integer',
  ),
  Schema.makeFilter((value: number) =>
    value >= MIN_INTERVAL_MINUTES
      ? undefined
      : `everyMinutes must be at least ${MIN_INTERVAL_MINUTES}`,
  ),
  Schema.makeFilter((value: number) =>
    value <= MAX_INTERVAL_MINUTES
      ? undefined
      : `everyMinutes must be at most ${MAX_INTERVAL_MINUTES}`,
  ),
);

const dailyScheduleSchema = struct({
  kind: Schema.Literal('daily'),
  time: timeSchema,
  timezone: timezoneSchema,
  weekdays: Schema.optional(
    Schema.mutable(
      Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 7 }))),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(7)),
  ),
}).check(
  Schema.makeFilter((value) =>
    isKnownTimeZone(value.timezone) ? undefined : 'unknown IANA time zone',
  ),
  Schema.makeFilter((value) =>
    value.weekdays === undefined || new Set(value.weekdays).size === value.weekdays.length
      ? undefined
      : 'weekdays must not contain duplicates',
  ),
);

const intervalScheduleSchema = struct({
  kind: Schema.Literal('interval'),
  everyMinutes: everyMinutesSchema,
});

export const routineScheduleSchema = Schema.Union([dailyScheduleSchema, intervalScheduleSchema]);

export type DailySchedule = Schema.Schema.Type<typeof dailyScheduleSchema>;
export type IntervalSchedule = Schema.Schema.Type<typeof intervalScheduleSchema>;
export type RoutineSchedule = Schema.Schema.Type<typeof routineScheduleSchema>;

export type ParsedSchedule = { ok: true; value: RoutineSchedule } | { ok: false; message: string };

// Walks the issue tree depth-first for the first custom `makeFilter` text.
function firstValidationMessage(issue: SchemaIssue.Issue): string | undefined {
  switch (issue._tag) {
    case 'Composite':
    case 'AnyOf':
      for (const child of issue.issues) {
        const message = firstValidationMessage(child);
        if (message !== undefined) {
          return message;
        }
      }
      return undefined;
    case 'Pointer':
    case 'Encoding':
      return firstValidationMessage(issue.issue);
    case 'Filter': {
      const message = issue.filter.annotations?.message;
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
      return firstValidationMessage(issue.issue);
    }
    case 'InvalidValue': {
      const message = issue.annotations?.message;
      return typeof message === 'string' && message.length > 0 ? message : undefined;
    }
    default:
      return undefined;
  }
}

// A union whose `kind` matches no member decodes to an empty `AnyOf` with no
// child issues, so no filter text is available: name the discriminator the
// way the old zod error did.
function scheduleMessage(issue: SchemaIssue.Issue, fullMessage: string): string {
  const custom = firstValidationMessage(issue);
  if (custom !== undefined) {
    return custom;
  }
  if (issue._tag === 'AnyOf' && issue.issues.length === 0) {
    return "kind must be 'daily' or 'interval'";
  }
  return fullMessage.split('\n')[0] ?? 'Invalid schedule';
}

// Validates an unknown schedule value at the boundary. `weekdays` defaults
// to all days; the normalised value always carries it explicitly for daily
// schedules. Unknown keys are rejected, like the old strict zod schemas.
export function parseRoutineSchedule(input: unknown): ParsedSchedule {
  const exit = Schema.decodeUnknownExit(routineScheduleSchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(input);
  if (!Exit.isSuccess(exit)) {
    for (const reason of exit.cause.reasons) {
      if (reason._tag === 'Fail') {
        return { ok: false, message: scheduleMessage(reason.error.issue, reason.error.message) };
      }
    }
    return { ok: false, message: 'Invalid schedule' };
  }
  const value = exit.value;
  if (value.kind === 'daily') {
    return {
      ok: true,
      value: { ...value, weekdays: value.weekdays ?? [1, 2, 3, 4, 5, 6, 7] },
    };
  }
  return { ok: true, value };
}

// The next occurrence strictly after `from`. Interval schedules anchor on
// `everyMinutes` boundaries since the epoch. Daily schedules fire at the
// wall-clock time in the zone on each selected weekday.
export function nextRunAfter(schedule: RoutineSchedule, from: Date): Date {
  if (schedule.kind === 'interval') {
    const stepMs = schedule.everyMinutes * 60_000;
    return new Date(Math.floor(from.getTime() / stepMs) * stepMs + stepMs);
  }
  const [hour, minute] = schedule.time.split(':').map(Number) as [number, number];
  const weekdays = new Set(schedule.weekdays ?? [1, 2, 3, 4, 5, 6, 7]);
  // Check `from`'s own zone day first, then up to one full week ahead, so a
  // weekday filter always finds its day.
  const fromDate = zoneDateOf(from, schedule.timezone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addDays(fromDate, offset);
    if (!weekdays.has(isoWeekday(date.year, date.month, date.day))) {
      continue;
    }
    const occurrence = dailyOccurrence(date, hour, minute, schedule.timezone);
    if (occurrence.getTime() > from.getTime()) {
      return occurrence;
    }
  }
  throw new Error('No daily occurrence found within a week');
}

// Whether `Intl` knows the zone. `DateTimeFormat` throws `RangeError` for
// an unknown zone name; a valid name never does.
export function isKnownTimeZone(timezone: string): boolean {
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

interface ZoneDate {
  year: number;
  month: number;
  day: number;
}

interface ZoneParts extends ZoneDate {
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function zoneParts(instant: Date, timezone: string): ZoneParts {
  const parts = formatterFor(timezone).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function zoneDateOf(instant: Date, timezone: string): ZoneDate {
  const parts = zoneParts(instant, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function addDays(date: ZoneDate, offset: number): ZoneDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

// Monday = 1 … Sunday = 7 for a calendar date.
function isoWeekday(year: number, month: number, day: number): number {
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return sundayFirst === 0 ? 7 : sundayFirst;
}

// The instant the zone wall clock reads midnight starting `date`.
// Iterative: shifting a UTC instant shifts the wall reading by (almost)
// the same amount, so adding the observed wall error converges even when
// a transition lands exactly at midnight.
function zoneMidnight(date: ZoneDate, timezone: string): Date {
  const targetDay = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = new Date(targetDay);
  for (let step = 0; step < 4; step += 1) {
    const parts = zoneParts(candidate, timezone);
    const wallMs =
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
      targetDay;
    if (wallMs === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() - wallMs);
  }
  return candidate;
}

// The instant the zone wall clock reads `hour:minute` on `date`,
// corrected for DST transitions. Resolution rule: the first UTC minute
// (scanning forward from midnight) whose wall reading is on `date` and at
// or after the target. On a normal day that is the target itself; on a
// spring-forward day a target inside the gap resolves to the first valid
// moment after the gap (02:30 becomes 03:00); on a fall-back day an
// ambiguous target resolves to its first occurrence. The fast path covers
// normal days with two `Intl` calls; only transition days pay the scan.
function dailyOccurrence(date: ZoneDate, hour: number, minute: number, timezone: string): Date {
  const midnight = zoneMidnight(date, timezone);
  // First guess: wall time advances 1:1 with UTC, so the instant is
  // midnight plus the wall offset. Exact on normal days (verified below);
  // transition days fall through to the scan.
  const naive = new Date(midnight.getTime() + (hour * 60 + minute) * 60_000);
  const parts = zoneParts(naive, timezone);
  if (
    parts.year === date.year &&
    parts.month === date.month &&
    parts.day === date.day &&
    parts.hour === hour &&
    parts.minute === minute
  ) {
    return naive;
  }
  // Transition day: scan UTC minutes forward from midnight. A zone day is
  // at most 26 hours (Lord Howe's 30-minute fall-back aside, 27 covers
  // every real zone), so 27 * 60 steps always terminate on `date`.
  for (let step = 0; step <= 27 * 60; step += 1) {
    const candidate = new Date(midnight.getTime() + step * 60_000);
    const wall = zoneParts(candidate, timezone);
    if (wall.year !== date.year || wall.month !== date.month || wall.day !== date.day) {
      continue;
    }
    if (wall.hour > hour || (wall.hour === hour && wall.minute >= minute)) {
      return candidate;
    }
  }
  return naive;
}
