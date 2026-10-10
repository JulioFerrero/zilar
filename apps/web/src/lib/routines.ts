// T-0876: the routine wording lives in @zilar/chat-core and is shared with
// mobile; this re-export keeps the web imports unchanged.
export {
  describeRoutineSchedule,
  MAX_OUTPUT_PREVIEW_CHARS,
  pausedReasonText,
  truncateOutput,
} from '@zilar/chat-core';
