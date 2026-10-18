import { Effect } from 'effect';
import type { ApiFailure } from '@zilar/client-core';

/**
 * The sentence shown for a failed call: the API's own message, or the fixed
 * fallback for anything else (user-facing errors are fixed sentences).
 */
export const textOf = (failure: ApiFailure, fallback: string): string =>
  failure.code === 'unknown_error' ? fallback : failure.message;

export const failInline =
  (setError: (message: string) => void, fallback: string) => (failure: ApiFailure) =>
    Effect.sync(() => setError(textOf(failure, fallback)));
