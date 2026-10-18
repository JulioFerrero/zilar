import { Effect } from 'effect';
import { ApiError } from '@/lib/api';
import { type ApiFailure, toApiFailure } from '@/lib/effect/errors';
import { StoreFailed } from '@/lib/errors';
import { describeAiError } from '../ais/errors';

export type ChannelFailure = ApiFailure | StoreFailed;

// A store action's rejection: an ApiError keeps its server message and code;
// a plain Error keeps its message; anything else gets the fallback.
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

export function failureText(failure: ChannelFailure, fallback: string): string {
  if (failure._tag === 'StoreFailed') {
    return failure.message;
  }
  return failure.code === 'unknown_error' ? fallback : failure.message;
}

export function describeFailure(failure: ChannelFailure, fallback: string): string {
  if (failure._tag === 'StoreFailed') {
    return failure.message;
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  ).message;
}
