import { Effect, Fiber } from 'effect';

// A timer as an Effect fiber: `run` happens after `ms`. Cancelling the timer
// interrupts its fiber (`interruptFiber`), as `clearTimeout` did.
export const runLater = (ms: number, run: () => void): Fiber.Fiber<void> =>
  Effect.runFork(Effect.sleep(ms).pipe(Effect.andThen(Effect.sync(run))));

// Interrupts a timer fiber that is still pending (the old `clearTimeout`).
// Waiting for the interrupt is not needed, so it runs on its own fork.
export function interruptFiber(fiber: Fiber.Fiber<unknown, unknown> | undefined): void {
  if (fiber !== undefined) {
    Effect.runFork(Fiber.interrupt(fiber));
  }
}
