import { handleSaveMessage } from '@zilar/chat-core';
import { fromApi } from '@zilar/client-core';
import { Effect } from 'effect';

export type HandleAvailability =
  { state: 'idle' } | { state: 'done'; available: boolean; reason?: string | undefined };

export const IDLE_AVAILABILITY: HandleAvailability = { state: 'idle' };

type AvailabilityResult = { available: boolean; reason?: string | undefined };

/** The 300 ms sleep is the debounce; useQuery interrupts it when the input changes.
 * A rate limit shows its own text, any other failure shows nothing. */
export function checkHandleAvailability(
  value: string,
  check: (value: string) => Promise<AvailabilityResult>,
): Effect.Effect<HandleAvailability> {
  return value === ''
    ? Effect.succeed(IDLE_AVAILABILITY)
    : Effect.sleep(300).pipe(
        Effect.andThen(fromApi(() => check(value))),
        Effect.map((result): HandleAvailability => ({
          state: 'done',
          available: result.available,
          reason: result.reason,
        })),
        Effect.catchTag('ApiFailure', (failure) =>
          Effect.succeed(
            failure.code === 'rate_limited'
              ? ({ state: 'done', available: false, reason: 'rate_limited' } as const)
              : IDLE_AVAILABILITY,
          ),
        ),
      );
}

export function handleReasonText(reason: string | undefined, noun: 'username' | 'handle'): string {
  switch (reason) {
    case 'invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'reserved':
      return `That ${noun} is reserved. Try another.`;
    case 'rate_limited':
      return 'Too many checks — wait a little and try again.';
    default:
      return `That ${noun} is taken. Try another.`;
  }
}

/** The shared save-error mapping, for callers that add their own fallback first. */
export function handleSaveError(
  failure: {
    readonly code: string;
    readonly message: string;
    readonly detail: Record<string, unknown>;
  },
  noun: 'username' | 'handle',
): string | undefined {
  const next = failure.detail.nextChangeAt;
  return handleSaveMessage(
    {
      code: failure.code,
      message: failure.message,
      nextChangeAt: typeof next === 'string' ? next : undefined,
    },
    noun,
  );
}
