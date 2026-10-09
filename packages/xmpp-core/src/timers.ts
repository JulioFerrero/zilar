import { Duration, Effect, Fiber } from 'effect';

export type Cancel = () => void;

// Runs `run` once after `ms`, like `setTimeout`, on an Effect fiber. The
// returned `Cancel` interrupts the fiber synchronously (like `clearTimeout`)
// and is safe to call again, after the timer has fired, or from inside `run`
// itself (all no-ops, as with `clearTimeout`). A defect thrown by `run` is
// rethrown from a separate timer task, so it surfaces as an uncaught
// exception exactly like a throw inside a `setTimeout` callback.
export function schedule(ms: number, run: () => void): Cancel {
  let finished = false;
  const fiber = Effect.runFork(
    Effect.sleep(Duration.millis(ms)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          finished = true;
          run();
        }),
      ),
      Effect.catchDefect((defect) =>
        Effect.sync(() => {
          // Surface it as an uncaught exception from a fresh timer task, the
          // way a throwing `setTimeout` callback does, instead of letting the
          // fiber swallow it.
          setTimeout(() => {
            throw defect;
          }, 0);
        }),
      ),
    ),
  );
  return () => {
    if (finished) return;
    finished = true;
    Effect.runSync(Fiber.interrupt(fiber));
  };
}
