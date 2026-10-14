// T-0876: the limits rules live in @zilar/chat-core and are shared with mobile.
import {
  formatLimit,
  MAX_MONTHLY_USD,
  validateLimits,
  type LimitsValidation,
} from '@zilar/chat-core';

export { formatLimit, MAX_MONTHLY_USD, validateLimits, type LimitsValidation };

/** "No spending limit" when neither bound is set; otherwise only the set bounds. */
export function formatLimits(limits: {
  perDayUsd: number | null;
  perMonthUsd: number | null;
}): string {
  const parts: string[] = [];
  if (limits.perDayUsd !== null) {
    parts.push(`${formatLimit(limits.perDayUsd)}/day`);
  }
  if (limits.perMonthUsd !== null) {
    parts.push(`${formatLimit(limits.perMonthUsd)}/month`);
  }
  return parts.length === 0 ? 'No spending limit' : parts.join(' · ');
}
