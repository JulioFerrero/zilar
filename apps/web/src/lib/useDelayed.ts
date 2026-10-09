import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useQuery } from '@/lib/effect/use-query';

/**
 * `value` once it has stayed the same for `delayMs`, otherwise undefined.
 * Transient states (a skeleton, "Connecting…") that resolve faster than the
 * delay never paint, so a fast load doesn't flash. Clearing is immediate.
 */
export function useDelayed<T>(value: T | undefined, delayMs: number): T | undefined {
  // Each new value starts a fresh sleep; the old one is interrupted with it.
  // Clearing needs no sleep, so `undefined` settles at once.
  const [settled] = useQuery(
    (): Effect.Effect<{ readonly value: T } | undefined> =>
      value === undefined
        ? Effect.succeed(undefined)
        : Effect.sleep(delayMs).pipe(Effect.as({ value })),
    [value, delayMs],
  );
  return value !== undefined &&
    AsyncResult.isSuccess(settled) &&
    settled.value !== undefined &&
    Object.is(settled.value.value, value)
    ? value
    : undefined;
}
