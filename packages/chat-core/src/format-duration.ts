/**
 * A duration as `m:ss`: `0:48`, `4:12`, and `61:05` past an hour. The one
 * time format the View steps panel and its cards use (T-1535 web, T-1562
 * phone); minutes never roll into hours.
 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
