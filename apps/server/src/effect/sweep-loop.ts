// The one background sweep loop behind every copied timer (T-2038): the
// approvals sweeper, the stuck-action recovery timer and the task-event
// retention sweeper all started with the same Effect scaffolding.
import { Effect, Schedule, type Fiber } from 'effect';

export interface SweepLoopHandle {
  close(): void;
}

// Starts `tick` after one interval, then every `intervalMs`. Each tick runs
// uninterruptibly, so `close()` only interrupts the sleep: an in-flight tick
// finishes and no new one is scheduled. Callers run `close()` before the
// database close so the in-flight queries settle on the live connection.
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
