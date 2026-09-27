const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en', { weekday: 'short' });
const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' });
const MONTH_DAY_YEAR_FORMAT = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Calendar days between two instants: 0 = today, 1 = yesterday, -1 = tomorrow. */
export function calendarDayDiff(iso: string, now: Date): number {
  const date = new Date(iso);
  return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
}

/** `HH:mm`, used inside bubbles and for today's rows in the chat list. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Chat list time: `HH:mm` today, the weekday within 7 days, else `dd.MM.yy`. */
export function formatListTime(iso: string, now: Date): string {
  const diff = calendarDayDiff(iso, now);
  if (diff <= 0) {
    return formatTime(iso);
  }
  const date = new Date(iso);
  if (diff < 7) {
    return WEEKDAY_FORMAT.format(date);
  }
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${pad2(date.getFullYear() % 100)}`;
}

/** Date separator: `Today`, `Yesterday` or `September 25`. */
export function formatDateSeparator(iso: string, now: Date): string {
  const diff = calendarDayDiff(iso, now);
  if (diff === 0) {
    return 'Today';
  }
  if (diff === 1) {
    return 'Yesterday';
  }
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear()
    ? MONTH_DAY_FORMAT.format(date)
    : MONTH_DAY_YEAR_FORMAT.format(date);
}

/** `m:ss`, e.g. `0:12`. */
export function formatVoiceDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(totalSeconds / 60)}:${pad2(totalSeconds % 60)}`;
}

/** `last seen 5 minutes ago`, `last seen 2 hours ago`, `last seen yesterday`. */
export function formatLastSeen(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (elapsed < MINUTE_MS) {
    return 'last seen just now';
  }
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 60) {
    return `last seen ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `last seen ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = calendarDayDiff(iso, now);
  if (days === 1) {
    return 'last seen yesterday';
  }
  if (days < 7) {
    return `last seen ${days} days ago`;
  }
  return `last seen on ${MONTH_DAY_FORMAT.format(new Date(iso))}`;
}
