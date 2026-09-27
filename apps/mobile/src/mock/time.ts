const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Local time on a past calendar day, as an ISO string. */
export function at(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}

export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
