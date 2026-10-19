// Mirrors the server's `describeSchedule`; schedules arrive as unknown JSON, so every shape validates first.

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

// Unknown shapes read `on a schedule` rather than crashing the list.
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
      record.everyMinutes >= 1
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

// Truncated with a "Show all" toggle, capped at 2 000 characters; the cut keeps plain text, never HTML.
export const MAX_OUTPUT_PREVIEW_CHARS = 2000;

export function truncateOutput(output: string): { preview: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_PREVIEW_CHARS) {
    return { preview: output, truncated: false };
  }
  return { preview: `${output.slice(0, MAX_OUTPUT_PREVIEW_CHARS)}…`, truncated: true };
}

export function routineStatusText(routine: {
  status: 'active' | 'paused' | 'needs_approval';
}): string {
  if (routine.status === 'needs_approval') {
    return 'needs approval';
  }
  if (routine.status === 'paused') {
    return 'paused';
  }
  return 'active';
}

export function routineLastText(routine: {
  lastStatus: 'ok' | 'error' | 'skipped' | null;
  lastRunAt: string | null;
}): string {
  if (routine.lastStatus === null) {
    return 'never run';
  }
  const at = routine.lastRunAt === null ? '' : ` · ${new Date(routine.lastRunAt).toLocaleString()}`;
  return `last ${routine.lastStatus}${at}`;
}

export function toolLastRunText(tool: {
  updatedAt: string;
  lastRunStatus: 'ok' | 'error' | null;
}): string {
  const at = new Date(tool.updatedAt);
  const status = tool.lastRunStatus === null ? 'never run' : `last run ${tool.lastRunStatus}`;
  return `${status} · ${at.toLocaleDateString()}`;
}

/** A run's status line, e.g. `ok · v3 · manual · 120 ms · <date>`. */
export function runStatusText(run: {
  createdAt: string;
  status: 'ok' | 'error';
  errorKind: string | null;
  version: number;
  trigger: 'manual' | 'routine' | 'ai';
  durationMs: number;
}): string {
  const at = new Date(run.createdAt);
  const label = run.status === 'ok' ? 'ok' : `error (${run.errorKind ?? 'failed'})`;
  return `${label} · v${run.version} · ${run.trigger} · ${run.durationMs} ms · ${at.toLocaleString()}`;
}
