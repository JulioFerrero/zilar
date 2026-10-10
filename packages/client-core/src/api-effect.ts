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
