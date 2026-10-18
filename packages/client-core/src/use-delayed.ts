import { Effect, Fiber } from 'effect';
import { useEffect, useState } from 'react';

// A timer as an Effect fiber: `run` happens after `ms`; cancelling interrupts its fiber,
// as `clearTimeout` did.
export const runLater = (ms: number, run: () => void): Fiber.Fiber<void> =>
  Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(run))));

// Interrupts a pending timer fiber; waiting for the interrupt is not needed, so it runs
// on its own fork.
export function interruptFiber(fiber: Fiber.Fiber<unknown, unknown> | undefined): void {
  if (fiber !== undefined) {
    Effect.runFork(Fiber.interrupt(fiber));
  }
}

/**
 * `value` once it has stayed the same for `delayMs`, otherwise undefined, so transient
 * states that resolve faster never paint and a fast load does not flash.
 */
export function useDelayed<T>(value: T | undefined, delayMs: number): T | undefined {
  const [settled, setSettled] = useState<T | undefined>(undefined);
  // Clearing is immediate: a changed value drops the settled one in the same render, so
  // a value that comes back later still waits out its own delay. Adjusted during render,
  // not in an effect.
  const [lastValue, setLastValue] = useState(value);
  if (!Object.is(lastValue, value)) {
    setLastValue(value);
    setSettled(undefined);
  }
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
