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

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
}

export function formatShortDate(date: Date): string {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`;
}

// `HH:mm` for today, the short weekday within the last seven days, otherwise `dd.MM.yy`.
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

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${pad(seconds)}`;
}

export function formatFullDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' }).format(date);
}
