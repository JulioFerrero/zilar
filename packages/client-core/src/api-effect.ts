import { Effect } from 'effect';
import type { ApiFailure } from './errors';

/**
 * Builds an app's `fromApi`: it lifts one api Promise call into an Effect,
 * mapping a rejection with the app's own `toApiFailure`. The signal aborts
 * when the Effect is interrupted; the api functions do not take it yet, so
 * callers usually ignore it: `fromApi(() => getMe())`.
 */
export const makeFromApi =
  (toApiFailure: (cause: unknown) => ApiFailure) =>
  <A>(call: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, ApiFailure> =>
    Effect.tryPromise({ try: call, catch: toApiFailure });

/**
 * Runs one Effect a caller may cancel. An abort rejects with the
 * `DOMException` named `AbortError`, as a `fetch` abort does, whether the
 * signal was already aborted, fires during the Effect, or fires before the
 * value is returned; every other failure is kept.
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
