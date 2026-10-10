import { Effect } from 'effect';
import { ApiError } from '@/lib/api';
import { type ApiFailure, toApiFailure } from '@/lib/effect/errors';
import { StoreFailed } from '@/lib/errors';
import { describeAiError } from '../ais/errors';

export type ChannelFailure = ApiFailure | StoreFailed;

// A store action's rejection. An ApiError stays an API failure (its server
// message, as before); a plain Error keeps its message; anything else gets
// the fallback.
export function storeCall<A>(
  call: () => Promise<A>,
  fallback: string,
): Effect.Effect<A, ChannelFailure> {
  return Effect.tryPromise({
    try: call,
    catch: (cause): ChannelFailure =>
      cause instanceof ApiError
        ? toApiFailure(cause)
        : new StoreFailed({ message: cause instanceof Error ? cause.message : fallback }),
  });
}

// The text a failure shows. An API failure keeps the server's own sentence, as
// before; any other throw (its failure is 'unknown_error') shows the fallback.
export function failureText(failure: ChannelFailure, fallback: string): string {
  if (failure._tag === 'StoreFailed') {
    return failure.message;
  }
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

// describeAiError reads an ApiError, so an API failure is rebuilt as one.
export function describeFailure(failure: ChannelFailure, fallback: string): string {
  if (failure._tag === 'StoreFailed') {
    return failure.message;
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  ).message;
}
