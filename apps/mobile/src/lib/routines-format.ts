// T-0876: the schedule wording lives in @zilar/chat-core and is shared with
// web; this file keeps the phone's row text and re-exports the shared part.
import {
  describeRoutineSchedule,
  MAX_OUTPUT_PREVIEW_CHARS,
  pausedReasonText,
  truncateOutput,
} from '@zilar/chat-core';

import type { Routine, ToolListItem } from './tools-api';

export { describeRoutineSchedule, MAX_OUTPUT_PREVIEW_CHARS, pausedReasonText, truncateOutput };

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
