import { useEffect, useState } from 'react';

import { interruptFiber, runLater } from '@/lib/effect/timers';

/**
 * `value` once it has stayed the same for `delayMs`, otherwise undefined.
 * Transient states (a skeleton, "Connecting…") that resolve faster than the
 * delay never paint, so a fast load doesn't flash. Clearing is immediate.
 */
export function useDelayed<T>(value: T | undefined, delayMs: number): T | undefined {
  const [settled, setSettled] = useState<T | undefined>(undefined);
  // Clearing is immediate: a changed value drops the settled one in the same
  // render, so a value that comes back later still waits out its own delay.
  // Adjusted during render, as the screens do, not in an effect.
  const [lastValue, setLastValue] = useState(value);
  if (!Object.is(lastValue, value)) {
    setLastValue(value);
    setSettled(undefined);
  }
  // Each new value starts a fresh sleep; the old one is interrupted with it.
  useEffect(() => {
    if (value === undefined) {
      return;
    }
    const fiber = runLater(delayMs, () => setSettled(() => value));
    return () => {
      interruptFiber(fiber);
    };
  }, [value, delayMs]);
  return value !== undefined && Object.is(settled, value) ? value : undefined;
}
