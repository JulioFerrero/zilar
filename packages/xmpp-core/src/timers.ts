import { Duration, Effect, Fiber } from 'effect';

export type Cancel = () => void;

// Like `setTimeout` on an Effect fiber; the Cancel interrupts synchronously and is safe
// to call again, after firing, or from inside `run`. A defect is rethrown from a
// separate timer task, so it surfaces as an uncaught exception.
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
          // Surface it as an uncaught exception from a fresh timer task, like a throwing callback.
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
