import type { ApprovalWorstCase } from '@/lib/approvals-api';

/**
 * The plain-English parts of one expiry countdown. Pure: takes `now` as a
 * parameter so the screen renders deterministically and tests can pin time
 * without faking timers. Mirrors web's `formatRelative.ts` wording where the
 * phone shows the same line ("expires in 12 min").
 */
export function expiresInText(expiresAt: string, now: Date): string {
  const totalMs = new Date(expiresAt).getTime() - now.getTime();
  if (totalMs <= 0) {
    return 'Expired';
  }
  const totalSeconds = Math.floor(totalMs / 1000);
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

/**
 * "Worst case: EUR 0.02" line. Empty string when `cost` is null (the server
 * sends null when the action has no money attached).
 */
export function worstCaseText(cost: ApprovalWorstCase | null): string {
  if (cost === null) {
    return '';
  }
  return `Worst case: ${cost.currency} ${cost.amount.toFixed(2)}`;
}

/**
 * "2 min ago" for a decided row. Mirrors web's `formatRelativeAudit` wording
 * (`AiActivity.tsx`) without the month-day tail: the phone's history tab
 * holds recent rows, and `Intl` date output differs between engines.
 */
export function decidedAgoText(decidedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(decidedAt).getTime()) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
