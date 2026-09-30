// T-0107: plain-words schedule descriptions for routines. Mirrors the
// server's `describeSchedule` in apps/server/src/tools/adapters.ts
// (same wording, unit-tested here so the two stay in sync). Schedules
// arrive as unknown JSON, so every shape validates first.

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface IntervalSchedule {
  kind: 'interval';
  everyMinutes: number;
}

interface DailySchedule {
  kind: 'daily';
  time: string;
  timezone: string;
  weekdays?: number[];
}

/**
 * A routine's schedule in plain words, e.g. `every 6 hours` or
 * `daily at 09:00 Europe/Madrid on Mon, Wed, Fri`. Unknown shapes read
 * `on a schedule` rather than crashing the list.
 */
export function describeRoutineSchedule(schedule: unknown): string {
  const parsed = parseSchedule(schedule);
  if (parsed === null) {
    return 'on a schedule';
  }
  if (parsed.kind === 'interval') {
    return describeInterval(parsed.everyMinutes);
  }
  const weekdays = parsed.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
  const days =
    weekdays.length === 7
      ? ''
      : ` on ${[...weekdays]
          .sort((a, b) => a - b)
          .map((day) => WEEKDAY_SHORT[day - 1])
          .join(', ')}`;
  return `daily at ${parsed.time} ${parsed.timezone}${days}`;
}

function describeInterval(everyMinutes: number): string {
  const plural = (count: number, word: string): string =>
    `every ${count} ${word}${count === 1 ? '' : 's'}`;
  if (everyMinutes % 1440 === 0) {
    return plural(everyMinutes / 1440, 'day');
  }
  if (everyMinutes % 60 === 0) {
    return plural(everyMinutes / 60, 'hour');
  }
  return plural(everyMinutes, 'minute');
}

function parseSchedule(schedule: unknown): IntervalSchedule | DailySchedule | null {
  if (schedule === null || typeof schedule !== 'object') {
    return null;
  }
  const record = schedule as Record<string, unknown>;
  if (record.kind === 'interval') {
    if (
      typeof record.everyMinutes === 'number' &&
      Number.isInteger(record.everyMinutes) &&
      record.everyMinutes >= 60
    ) {
      return { kind: 'interval', everyMinutes: record.everyMinutes };
    }
    return null;
  }
  if (record.kind === 'daily') {
    if (
      typeof record.time !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(record.time) ||
      typeof record.timezone !== 'string' ||
      record.timezone === ''
    ) {
      return null;
    }
    if (record.weekdays === undefined) {
      return { kind: 'daily', time: record.time, timezone: record.timezone };
    }
    if (
      !Array.isArray(record.weekdays) ||
      record.weekdays.length === 0 ||
      !record.weekdays.every(
        (day): day is number =>
          typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7,
      )
    ) {
      return null;
    }
    return {
      kind: 'daily',
      time: record.time,
      timezone: record.timezone,
      weekdays: [...record.weekdays],
    };
  }
  return null;
}

/**
 * A paused reason with its explanation line, for the routines list. A
 * `hosts_changed` or `failures` pause tells the viewer what to do next
 * (ask the AI to re-approve), per the spec.
 */
export function pausedReasonText(
  reason: 'user' | 'failures' | 'hosts_changed' | null,
  status: 'active' | 'paused' | 'needs_approval',
): string | null {
  if (status === 'needs_approval' || reason === 'hosts_changed') {
    return 'Paused: the tool now contacts new sites. Ask the AI to schedule it again to approve them.';
  }
  if (reason === 'failures') {
    return 'Paused after repeated failures. Ask the AI to fix it.';
  }
  if (reason === 'user') {
    return 'Paused by a person.';
  }
  return null;
}

/**
 * Long tool output truncated with a "Show all" toggle. The cut keeps plain
 * text (never HTML), capped at 2 000 characters.
 */
export const MAX_OUTPUT_PREVIEW_CHARS = 2000;

export function truncateOutput(output: string): { preview: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_PREVIEW_CHARS) {
    return { preview: output, truncated: false };
  }
  return { preview: `${output.slice(0, MAX_OUTPUT_PREVIEW_CHARS)}…`, truncated: true };
}
