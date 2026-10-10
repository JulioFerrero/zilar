import { Effect } from 'effect';
import type { ApiFailure } from '@/lib/effect/errors';

/**
 * The sentence shown for a failed call: the API's own message, or the fixed
 * fallback for anything else (AGENTS.md: user-facing errors are fixed sentences).
 */
export const textOf = (failure: ApiFailure, fallback: string): string =>
  failure.code === 'unknown_error' ? fallback : failure.message;

/** Shows a failure as the panel's inline error, with its fixed fallback. */
export const failInline =
  (setError: (message: string) => void, fallback: string) => (failure: ApiFailure) =>
    Effect.sync(() => setError(textOf(failure, fallback)));
