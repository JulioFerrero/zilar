/** `$2` -> `$2.00`. Server amounts are plain USD numbers. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
