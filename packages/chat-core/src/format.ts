const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function calendarDayDiff(date: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Wall clock time as `HH:mm` (24-hour). */
export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Short weekday in `en`, e.g. `Mon`. */
export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
}

/** `dd.MM.yy`, e.g. `25.09.26`. */
export function formatShortDate(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`;
}

/**
 * Time shown in the chat list: `HH:mm` for today, the short weekday within the
 * last seven days, otherwise `dd.MM.yy`.
 */
export function formatListTime(date: Date, now: Date): string {
  const diff = calendarDayDiff(date, now);
  if (diff === 0) {
    return formatTime(date);
  }
  if (diff > 0 && diff < 7) {
    return formatWeekday(date);
  }
  return formatShortDate(date);
}

/**
 * Label for a day separator: `Today`, `Yesterday` or the month and day in
 * `en` (e.g. `September 25`).
 */
export function formatDateSeparator(date: Date, now: Date): string {
  const diff = calendarDayDiff(date, now);
  if (diff === 0) {
    return 'Today';
  }
  if (diff === 1) {
    return 'Yesterday';
  }
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(date);
}

/** Duration as `m:ss`, e.g. `0:12` or `1:05`. */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${pad(seconds)}`;
}

/** Full date and time for the hover tooltip on a message, e.g. `27 September 2026, 12:41`. */
export function formatFullDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(date);
}
