import {
  describeRoutineSchedule,
  MAX_OUTPUT_PREVIEW_CHARS,
  pausedReasonText,
  routineLastText,
  routineStatusText,
  toolLastRunText,
  truncateOutput,
} from '@zilar/chat-core';
import type { Routine } from '@zilar/client-core';

export {
  describeRoutineSchedule,
  MAX_OUTPUT_PREVIEW_CHARS,
  pausedReasonText,
  routineLastText,
  routineStatusText,
  toolLastRunText,
  truncateOutput,
};

export function hostsLine(hosts: readonly string[]): string {
  return hosts.length === 0 ? 'no sites' : hosts.join(', ');
}

export function nextRunText(routine: Routine): string {
  return `next ${new Date(routine.nextRunAt).toLocaleString()}`;
}
