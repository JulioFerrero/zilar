import type { AiLimits } from '@/lib/api';

// The same ceiling as MAX_MONTHLY_USD in apps/server/src/ais/service.ts. It is
// a product safety limit, so the client can only ever narrow it.
export const MAX_MONTHLY_USD = 200;

export interface LimitsValidation {
  /** The limits to send, or null while either field is invalid. */
  limits: AiLimits | null;
  dayError: string;
  monthError: string;
}

// Client twin of the server's LimitsSchema: both amounts must be positive, the
// day must fit inside the month, and the month is capped. USD, because that is
// what the server stores.
export function validateLimits(dayText: string, monthText: string): LimitsValidation {
  const day = parseAmount(dayText);
  const month = parseAmount(monthText);
  let dayError = '';
  let monthError = '';

  if (day === null) {
    dayError = 'Enter a daily amount greater than 0';
  }
  if (month === null) {
    monthError = 'Enter a monthly amount greater than 0';
  }
  if (day !== null && month !== null && day > month) {
    dayError = 'The daily limit must not exceed the monthly limit';
  }
  if (month !== null && month > MAX_MONTHLY_USD) {
    monthError = `The monthly limit must be at most $${MAX_MONTHLY_USD}`;
  }

  return {
    limits:
      day !== null && month !== null && dayError === '' && monthError === ''
        ? { perDayUsd: day, perMonthUsd: month }
        : null,
    dayError,
    monthError,
  };
}

function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/** `2` -> `$2`. The server stores plain USD numbers. */
export function formatLimit(value: number): string {
  return `$${value}`;
}
