import { useEffect, useState } from 'react';

/**
 * `value` once it has stayed the same for `delayMs`, otherwise undefined.
 * Transient states (a skeleton, "Connecting…") that resolve faster than the
 * delay never paint, so a fast load doesn't flash. Clearing is immediate.
 */
export function useDelayed<T>(value: T | undefined, delayMs: number): T | undefined {
  const [settled, setSettled] = useState<{ value: T } | undefined>(undefined);
  useEffect(() => {
    // Hiding is derived below; the reset only makes a later repeat wait again.
    const timer =
      value === undefined
        ? setTimeout(() => setSettled(undefined), 0)
        : setTimeout(() => setSettled({ value }), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return value !== undefined && settled !== undefined && Object.is(settled.value, value)
    ? value
    : undefined;
}
