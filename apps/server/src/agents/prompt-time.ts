/**
 * Renders an instant as e.g. `Thursday, 15 October 2026, 04:12 (Europe/Madrid)`.
 * A `null` zone renders the same instant in UTC and ends with `(UTC)`.
 */
export function promptNow(now: Date, timeZone: string | null): string {
  const zone = timeZone ?? 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values: Record<string, string> = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }
  const date = `${values['weekday']}, ${values['day']} ${values['month']} ${values['year']}`;
  const time = `${values['hour']}:${values['minute']}`;
  return `${date}, ${time} (${zone})`;
}
