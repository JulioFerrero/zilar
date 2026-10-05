// T-0189: a copy of `apps/web/src/lib/routines.ts` (135 lines, pure, no
// imports), so the phone words schedules exactly like web. Mirrors the
// server's `describeSchedule` in apps/server/src/tools/adapters.ts.

import type { Routine, ToolListItem } from './tools-api';

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

// --- Row text (from web ToolsSection/RoutinesSection render) ----------------

/**
 * The declared hosts of a tool, e.g. `example.com, api.example.com`.
 * Empty reads `no sites`, like web.
 */
export function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

/**
 * A tool's last-run line, e.g. `never run · 10/3/2026` or
 * `last run ok · 10/3/2026`, like web `lastRunText`.
 */
export function toolLastRunText(tool: ToolListItem): string {
  const at = new Date(tool.updatedAt);
  const status = tool.lastRunStatus === null ? 'never run' : `last run ${tool.lastRunStatus}`;
  return `${status} · ${at.toLocaleDateString()}`;
}

/**
 * A routine's status in plain words, like web `statusText`.
 */
export function routineStatusText(routine: Routine): string {
  if (routine.status === 'needs_approval') {
    return 'needs approval';
  }
  if (routine.status === 'paused') {
    return 'paused';
  }
  return 'active';
}

/**
 * A routine's next run, e.g. `next 10/4/2026, 9:00:00 AM`, like web.
 */
export function nextRunText(routine: Routine): string {
  return `next ${new Date(routine.nextRunAt).toLocaleString()}`;
}

/**
 * A routine's last run, e.g. `never run` or `last ok · 10/4/2026, ...`,
 * like web `lastStatusText`.
 */
export function routineLastText(routine: Routine): string {
  if (routine.lastStatus === null) {
    return 'never run';
  }
  const at = routine.lastRunAt === null ? '' : ` · ${new Date(routine.lastRunAt).toLocaleString()}`;
  return `last ${routine.lastStatus}${at}`;
}
