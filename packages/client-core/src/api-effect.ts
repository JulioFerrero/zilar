import { Effect } from 'effect';
import type { ApiFailure } from './errors';

/** Lifts one api Promise call into an Effect that fails with the app's `toApiFailure`. */
export const makeFromApi =
  (toApiFailure: (cause: unknown) => ApiFailure) =>
  <A>(call: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ApiFailure> =>
    Effect.tryPromise({ try: call, catch: toApiFailure });

/**
 * Runs one Effect a caller may cancel. An abort rejects with `AbortError`, as a
 * `fetch` abort does; every other failure is kept.
 */
export async function runApiAbortable<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  // A function, not a direct read, so TypeScript does not narrow `aborted` to
  // `false` after the first check: the signal can still fire mid-request.
  const isAborted = () => signal?.aborted === true;
  const abortError = () => new DOMException('Aborted', 'AbortError');
  if (isAborted()) {
    throw abortError();
  }
  let value: A;
  try {
    value = await Effect.runPromise(effect, signal === undefined ? undefined : { signal });
  } catch (error) {
    throw isAborted() ? abortError() : error;
  }
  if (isAborted()) {
    throw abortError();
  }
  return value;
}
