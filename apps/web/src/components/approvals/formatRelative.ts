import type { Money } from '@galena/protocol';

export interface ExpiryParts {
  totalMs: number;
  totalSeconds: number;
}

/**
 * Milliseconds between `now` and `expiresAt`. Positive when the request is
 * still valid, zero or negative when it has already expired.
 */
export function expiryParts(expiresAt: string, now: Date): ExpiryParts {
  const totalMs = new Date(expiresAt).getTime() - now.getTime();
  return {
    totalMs,
    totalSeconds: Math.max(0, Math.floor(totalMs / 1000)),
  };
}

/**
 * `expiresAt` as a short, plain-English countdown: "in 12 min", "in 45 sec",
 * "in 1 hour", "in 2 days". "Expired" when the deadline has already passed.
 * Pure: takes `now` as a parameter so the page renders deterministically and
 * tests can pin time without faking timers.
 */
export function expiresInText(expiresAt: string, now: Date): string {
  const { totalMs, totalSeconds } = expiryParts(expiresAt, now);
  if (totalMs <= 0) {
    return 'Expired';
  }
  if (totalSeconds < 60) {
    return `in ${totalSeconds} sec`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `in ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** "Worst case: €0.40" line. Empty string when `cost` is null. */
export function worstCaseText(cost: Money | null): string {
  return cost === null ? '' : `Worst case: ${formatMoney(cost)}`;
}

function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: money.currency }).format(
    money.amount,
  );
}
