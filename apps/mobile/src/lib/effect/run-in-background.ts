import { Effect } from 'effect';

interface BackgroundHandlers<A> {
  onSuccess?: (value: A) => void;
  onFailure?: (error: unknown) => void;
  onSettled?: () => void;
}

// Starts the call now and returns at once: separate taps run side by side (no single-flight), and a throw in `onSuccess` reaches `onFailure`.
export function runInBackground<A>(call: () => Promise<A>, handlers: BackgroundHandlers<A>): void {
  Effect.runFork(
    Effect.tryPromise({ try: call, catch: (error) => error }).pipe(
      Effect.tap((value) => Effect.sync(() => handlers.onSuccess?.(value))),
      Effect.catch((error) => Effect.sync(() => handlers.onFailure?.(error))),
      Effect.ensuring(Effect.sync(() => handlers.onSettled?.())),
    ),
  );
}
