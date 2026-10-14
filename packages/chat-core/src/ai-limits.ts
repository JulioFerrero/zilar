import type { AiLimitsUsd } from './ai-form';

// The same ceiling as MAX_MONTHLY_USD in apps/server/src/ais/service.ts. It is
// a product safety limit, so the client can only ever narrow it.
export const MAX_MONTHLY_USD = 200;

export interface LimitsValidation {
  /** The limits to send, or null while either field is invalid. */
  limits: AiLimitsUsd | null;
  dayError: string;
  monthError: string;
}

// Client twin of the server's LimitsSchema: an empty field means "no limit";
// a set amount must be positive, the day must fit inside the month, and the
// month is capped. USD, because that is what the server stores.
export function validateLimits(dayText: string, monthText: string): LimitsValidation {
  const day = parseAmount(dayText);
  const month = parseAmount(monthText);
  const dayValue = day === undefined ? null : day;
  const monthValue = month === undefined ? null : month;
  let dayError = '';
  let monthError = '';

  if (day === undefined) {
    dayError = 'Enter a daily amount greater than 0';
  }
  if (month === undefined) {
    monthError = 'Enter a monthly amount greater than 0';
  }
  if (dayValue !== null && monthValue !== null && dayValue > monthValue) {
    dayError = 'The daily limit must not exceed the monthly limit';
  }
  if (monthValue !== null && monthValue > MAX_MONTHLY_USD) {
    monthError = `The monthly limit must be at most $${MAX_MONTHLY_USD}`;
  }

  return {
    limits:
      dayError === '' && monthError === ''
        ? { perDayUsd: dayValue, perMonthUsd: monthValue }
        : null,
    dayError,
    monthError,
  };
}

// `null` for an empty field (no limit), `undefined` for text that is not a
// positive amount, a number otherwise.
function parseAmount(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

/** `2` -> `$2`; a `null` bound is shown as "No limit". */
export function formatLimit(value: number | null): string {
  return value === null ? 'No limit' : `$${value}`;
}
