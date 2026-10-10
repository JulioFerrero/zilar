// Session speed analysis for `lead watch`, moved unchanged from
// `lead/watch.ts` (size split).

import { isRecord } from './live-step.js';

export interface SessionSpeed {
  tokPerSec: number;
  secPerStep: number;
  context: number;
  spark: number[];
}

// Median output speed, gap between steps, latest context size, and a 10-bar
// sparkline of the per-step tok/s of the last 10 steps. Messages come back
// newest-first; the analysis is built from the most recent 20 assistant
// steps, then narrowed to the last 10 for the sparkline. The shown speed is
// the median of those same per-step values, so one step that waited on a hung
// tool never drags it down. Fewer than 2 usable completed steps (with
// `time.completed` set and a non-zero gap) returns `null`. Defensive on
// unknown shapes: never throws.
export function sessionSpeed(messages: unknown[]): SessionSpeed | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const steps: SpeedStep[] = [];
  for (const message of messages) {
    const step = parseSpeedStep(message);
    if (step === null) {
      continue;
    }
    steps.push(step);
    if (steps.length >= 20) {
      break;
    }
  }
  if (steps.length < 2) {
    return null;
  }
  // Newest-first → oldest-first so the gaps line up.
  steps.reverse();
  const newest = steps[steps.length - 1]!;
  const gaps: number[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    gaps.push(steps[i]!.created - steps[i - 1]!.created);
  }
  const totalGap = gaps.reduce((sum, gap) => sum + gap, 0);
  const secPerStep = gaps.length > 0 ? totalGap / gaps.length / 1000 : 0;
  const context = newest.contextSize;
  const recent = steps.slice(-10);
  const spark: number[] = [];
  for (const step of recent) {
    spark.push(step.duration > 0 ? step.tokensOut / (step.duration / 1000) : 0);
  }
  return {
    tokPerSec: median(spark),
    secPerStep,
    context,
    spark,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface SpeedStep {
  tokensOut: number;
  created: number;
  duration: number;
  contextSize: number;
}

function parseSpeedStep(message: unknown): SpeedStep | null {
  if (!isRecord(message)) {
    return null;
  }
  if (message['type'] !== 'assistant') {
    return null;
  }
  const time = isRecord(message['time']) ? message['time'] : {};
  const created = time['created'];
  const completed = time['completed'];
  if (typeof created !== 'number' || typeof completed !== 'number') {
    return null;
  }
  if (completed <= created) {
    return null;
  }
  const tokens = isRecord(message['tokens']) ? message['tokens'] : {};
  const output = numberField(tokens['output']);
  const reasoning = numberField(tokens['reasoning']);
  const input = numberField(tokens['input']);
  const cache = isRecord(tokens['cache']) ? tokens['cache'] : {};
  const cacheRead = numberField(cache['read']);
  return {
    tokensOut: output + reasoning,
    created,
    duration: completed - created,
    contextSize: input + cacheRead,
  };
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
