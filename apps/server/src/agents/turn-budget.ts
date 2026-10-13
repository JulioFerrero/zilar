// T-1290 (AI-14): the timeout for one model call inside a tool turn is what
// is left of the turn's wall clock, floored so a nearly-spent budget still
// lets the call finish instead of aborting at once. Every round and the
// closing call use it, so one slow provider can no longer hold the turn —
// and every later owner message — for the 90 s each call would otherwise get.
import { TOOL_TURN_WALL_CLOCK_MS } from './tool-loop';

export const TOOL_TURN_MIN_CALL_MS = 5_000;

export function remainingTurnBudgetMs(
  startedAt: number,
  nowMs: () => number,
  floorMs: number = TOOL_TURN_MIN_CALL_MS,
): number {
  return Math.max(floorMs, TOOL_TURN_WALL_CLOCK_MS - (nowMs() - startedAt));
}
