import type { Progress } from '@zilar/protocol';

export interface CountdownParts {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly past: boolean;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// `days` is 0 under a day; a target already reached or unreadable is all zeroes with `past` true, never negative.
export function countdownParts(targetAt: string, nowMs: number): CountdownParts {
  const target = Date.parse(targetAt);
  const remaining = Number.isNaN(target) ? 0 : target - nowMs;
  if (remaining <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, past: true };
  }
  return {
    days: Math.floor(remaining / DAY_MS),
    hours: Math.floor((remaining % DAY_MS) / HOUR_MS),
    minutes: Math.floor((remaining % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((remaining % MINUTE_MS) / SECOND_MS),
    past: false,
  };
}

/** A card without a terminal state is still working. */
export function isLive(state: Progress['state']): boolean {
  return state === undefined || state === 'working';
}

export function ratioPercent(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  return `${Math.round(clamped * 100)}%`;
}
