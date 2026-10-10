import { Effect } from 'effect';

interface BackgroundHandlers<A> {
  /** Runs with the value when the call resolves. */
  onSuccess?: (value: A) => void;
  /** Runs with the rejection (kept as it came: the role messages read its `status`). */
  onFailure?: (error: unknown) => void;
  /** Runs last, after a success, a failure or an interrupt. */
  onSettled?: () => void;
}

// Starts one store or native call now and returns at once, like the
// `void call().then(..).catch(..).finally(..)` chains it replaces: calls from
// separate taps run side by side (no single-flight), and a throw in
// `onSuccess` reaches `onFailure`.
export function runInBackground<A>(call: () => Promise<A>, handlers: BackgroundHandlers<A>): void {
  Effect.runFork(
    Effect.tryPromise({ try: call, catch: (error) => error }).pipe(
      Effect.tap((value) => Effect.sync(() => handlers.onSuccess?.(value))),
      Effect.catch((error) => Effect.sync(() => handlers.onFailure?.(error))),
      Effect.ensuring(Effect.sync(() => handlers.onSettled?.())),
    ),
  );
}
