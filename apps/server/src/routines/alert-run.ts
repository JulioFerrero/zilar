// T-1878: the alert card's quiet run. A routine linked to an alert card reads
// the tool's numeric `output.data.value` and compares it with the number in
// `input.threshold` (`setRoutineThreshold` in `./alert-link`). Below it the run
// stays `ok` and silent; at or above it posts like any other run. A run with no
// number on either side is a failure, so it counts toward the 3-failure pause.
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
