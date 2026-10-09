import { Effect } from 'effect';
import { type ApiFailure, toApiFailure } from '@/lib/effect/errors';

/**
 * Lifts one *-api.ts Promise call into an Effect. The signal aborts when the
 * Effect is interrupted; the api functions do not take it yet, so callers
 * usually ignore it: `fromApi(() => getMe())`.
 */
export const fromApi = <A>(
  call: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, ApiFailure> => Effect.tryPromise({ try: call, catch: toApiFailure });
