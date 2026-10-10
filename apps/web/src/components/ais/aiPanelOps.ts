import { Effect } from 'effect';
import { ApiError, getAi, type PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { describeAiError, type AiErrorInfo } from './errors';

export type PanelStatus = 'loading' | 'ready' | 'missing' | 'error';

// An api.ts failure keeps its server answer: it is rebuilt as the ApiError that
// describeAiError reads. A failure with no status did not come from the server,
// so it shows the fixed fallback sentence instead of the thrown text.
export function describeFailure(failure: ApiFailure, fallback: string): AiErrorInfo {
  if (failure.status === 0) {
    return { message: fallback, unavailable: false };
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  );
}

// Reads the AI again after a failed write. The read is best-effort: the inline
// error stays visible whether or not it works, so its own failure is dropped.
export const refetchAi = (id: string, apply: (next: PublicAi) => void) =>
  fromApi(() => getAi(id)).pipe(
    Effect.tap((fresh) => Effect.sync(() => apply(fresh))),
    Effect.catchTag('ApiFailure', () => Effect.void),
  );

// The AI's picture is cleared by dropping `avatarUrl` from the row the panel
// already has, without a round trip (T-0165).
export function stripAvatarUrl(ai: PublicAi): PublicAi {
  const { avatarUrl: _removed, ...rest } = ai;
  void _removed;
  return rest;
}

/**
 * The one write an AI panel action runs: clear its inline error, call the
 * server, hand the fresh AI to `onSuccess`, and on failure show the action's
 * own fixed sentence and (when asked) read the AI again so the panel matches
 * the server. Stop, resume, delete and the delegation switches all share it.
 */
export function writeAi<A>(options: {
  readonly clearError: () => void;
  readonly setError: (message: string) => void;
  readonly failedText: string;
  readonly call: () => Promise<A>;
  readonly onSuccess: (value: A) => void;
  readonly refetch?: { readonly id: string; readonly apply: (next: PublicAi) => void };
}): Effect.Effect<void, never, never> {
  return Effect.sync(options.clearError).pipe(
    Effect.andThen(fromApi(options.call)),
    Effect.tap((value) => Effect.sync(() => options.onSuccess(value))),
    Effect.asVoid,
    Effect.catchTag('ApiFailure', (failure) =>
      Effect.sync(() =>
        options.setError(describeFailure(failure, options.failedText).message),
      ).pipe(
        Effect.andThen(
          options.refetch === undefined
            ? Effect.void
            : refetchAi(options.refetch.id, options.refetch.apply),
        ),
      ),
    ),
  );
}
