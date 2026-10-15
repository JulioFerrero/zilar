// T-1290 (AI-14): the timeout for one model call inside a tool turn is what
// is left of the turn's wall clock, floored so a nearly-spent budget still
// lets the call finish instead of aborting at once. Every round and the
// closing call use it, so one slow provider can no longer hold the turn —
// and every later owner message — for the 90 s each call would otherwise get.
// T-1611: it is also capped at `MODEL_CALL_MAX_MS`, and callers pass their
// turn's own wall clock so a computer turn's longer budget does not give one
// model call an unbounded wait.
import { MODEL_CALL_MAX_MS, TOOL_TURN_WALL_CLOCK_MS } from './tool-loop';

export const TOOL_TURN_MIN_CALL_MS = 5_000;

export function remainingTurnBudgetMs(
  startedAt: number,
  nowMs: () => number,
  wallClockMs: number = TOOL_TURN_WALL_CLOCK_MS,
  floorMs: number = TOOL_TURN_MIN_CALL_MS,
): number {
  return Math.min(MODEL_CALL_MAX_MS, Math.max(floorMs, wallClockMs - (nowMs() - startedAt)));
}
