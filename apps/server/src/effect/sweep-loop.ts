// The one background sweep loop behind every timer copy.
import { Effect, Schedule, type Fiber } from 'effect';

export interface SweepLoopHandle {
  close(): void;
}

// Runs `tick` after one interval, then every `intervalMs`, uninterruptibly:
// `close()` only interrupts the sleep, so an in-flight tick finishes. Callers
// close this before the database so its queries settle on a live connection.
export function startSweepLoop(intervalMs: number, tick: () => Promise<void>): SweepLoopHandle {
  const tickEffect = Effect.uninterruptible(Effect.promise(() => tick()));
  const loop = Effect.sleep(intervalMs).pipe(
    Effect.andThen(Effect.repeat(tickEffect, Schedule.spaced(intervalMs))),
    Effect.asVoid,
  );
  let fiber: Fiber.Fiber<void, never> | null = Effect.runFork(loop);

  return {
    close(): void {
      if (fiber !== null) {
        fiber.interruptUnsafe();
        fiber = null;
      }
    },
  };
}
