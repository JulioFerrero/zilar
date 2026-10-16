// The shared maths behind the progress group (T-1772): web and phone derive the
// same countdown tiles and the same percentage from the same payload, so both
// read one file. No React here; the renderers pick the colours.

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

/**
 * Splits the time from `nowMs` to `targetAt` into whole days, hours, minutes and
 * seconds. `days` is 0 under a day, so a caller shows that tile only when it is
 * at least 1. A target already reached — or an unreadable date — is all zeroes
 * with `past` true, never negative numbers.
 */
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

/** A 0–1 ratio as the whole-percent string the bars show, clamped to 0–1. */
export function ratioPercent(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  return `${Math.round(clamped * 100)}%`;
}
