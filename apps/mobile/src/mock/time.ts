const HOUR_MS = 3_600_000;

/** Local time on a past calendar day, as a `Date`. */
export function at(daysAgo: number, hour: number, minute: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** An ISO timestamp, for the protocol payloads that need one. */
export function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * HOUR_MS).toISOString();
}
