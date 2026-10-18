// A routine linked to an alert card reads the tool's `output.data.value` and compares it with `input.threshold`.
// Below it the run stays `ok` and silent; at or above it posts; a missing number on either side is a failure.
export type AlertVerdict =
  { kind: 'post'; value: number } | { kind: 'quiet'; value: number } | { kind: 'error' };

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readKey(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

export function alertVerdict(input: unknown, data: unknown): AlertVerdict {
  const value = finiteNumber(readKey(data, 'value'));
  const threshold = finiteNumber(readKey(input, 'threshold'));
  if (value === null || threshold === null) {
    return { kind: 'error' };
  }
  return value >= threshold ? { kind: 'post', value } : { kind: 'quiet', value };
}
