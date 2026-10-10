// Truncates model-facing text, appending `…` when cut.

export function truncateChars(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}
