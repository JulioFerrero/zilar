import {
  describeRoutineSchedule,
  MAX_OUTPUT_PREVIEW_CHARS,
  pausedReasonText,
  truncateOutput,
} from '@zilar/chat-core';

import type { Routine, ToolListItem } from './tools-api';

export { describeRoutineSchedule, MAX_OUTPUT_PREVIEW_CHARS, pausedReasonText, truncateOutput };

export function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

export function toolLastRunText(tool: ToolListItem): string {
  const at = new Date(tool.updatedAt);
  const status = tool.lastRunStatus === null ? 'never run' : `last run ${tool.lastRunStatus}`;
  return `${status} · ${at.toLocaleDateString()}`;
}

export function routineStatusText(routine: Routine): string {
  if (routine.status === 'needs_approval') {
    return 'needs approval';
  }
  if (routine.status === 'paused') {
    return 'paused';
  }
  return 'active';
}

export function nextRunText(routine: Routine): string {
  return `next ${new Date(routine.nextRunAt).toLocaleString()}`;
}

export function routineLastText(routine: Routine): string {
  if (routine.lastStatus === null) {
    return 'never run';
  }
  const at = routine.lastRunAt === null ? '' : ` · ${new Date(routine.lastRunAt).toLocaleString()}`;
  return `last ${routine.lastStatus}${at}`;
}
