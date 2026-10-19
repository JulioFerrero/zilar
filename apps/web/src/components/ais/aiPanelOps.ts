import { Effect } from 'effect';
import { ApiError, getAi, type PublicAi } from '@/lib/api';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { describeAiError } from './errors';
import type { AiErrorInfo } from '@zilar/chat-core';

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

export const refetchAi = (id: string, apply: (next: PublicAi) => void) =>
  fromApi(() => getAi(id)).pipe(
    Effect.tap((fresh) => Effect.sync(() => apply(fresh))),
    Effect.catchTag('ApiFailure', () => Effect.void),
  );

export function stripAvatarUrl(ai: PublicAi): PublicAi {
  const { avatarUrl: _removed, ...rest } = ai;
  void _removed;
  return rest;
}

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
