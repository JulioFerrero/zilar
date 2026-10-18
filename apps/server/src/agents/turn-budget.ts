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
