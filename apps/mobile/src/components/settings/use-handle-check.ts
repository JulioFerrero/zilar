import { Effect } from 'effect';
import { useEffect } from 'react';

import { interruptFiber } from '@/lib/effect/timers';
import { type ProfileApi } from '@/lib/profile-api';

import {
  handleAvailabilityFor,
  isHandleRateLimited,
  type HandleAvailability,
} from '@/components/settings/profile-logic';

const HANDLE_CHECK_DEBOUNCE_MS = 300;

/** What `useHandleCheck` reads: the API, the trimmed handle and the setter. */
type HandleCheckOptions = {
  readonly api: ProfileApi;
  readonly trimmed: string;
  readonly ownHandle: boolean;
  readonly setAvailability: (next: HandleAvailability) => void;
};

/**
 * Debounced live availability for a changed handle. A forked fiber waits the
 * debounce, then applies the result; a handle change interrupts it. Your own
 * handle (any casing) skips the check: the server sees its live row and would
 * report "taken", which is misleading next to an enabled Save.
 */
export function useHandleCheck({ api, trimmed, ownHandle, setAvailability }: HandleCheckOptions) {
  useEffect(() => {
    if (trimmed === '' || ownHandle) {
      return;
    }
    const value = trimmed;
    const check = Effect.sleep(HANDLE_CHECK_DEBOUNCE_MS).pipe(
      Effect.andThen(
        Effect.sync(() => {
          setAvailability({ state: 'checking' });
        }),
      ),
      Effect.andThen(
        Effect.tryPromise({
          try: () => api.checkHandle(value),
          catch: (cause) => cause,
        }),
      ),
      Effect.match({
        onSuccess: (result) =>
          handleAvailabilityFor(value, {
            ok: true,
            available: result.available,
            reason: result.reason,
          }),
        onFailure: (checkError) =>
          handleAvailabilityFor(value, {
            ok: false,
            rateLimited: isHandleRateLimited(checkError),
          }),
      }),
      Effect.andThen((next: HandleAvailability) =>
        Effect.sync(() => {
          setAvailability(next);
        }),
      ),
    );
    const fiber = Effect.runFork(check);
    return () => {
      interruptFiber(fiber);
    };
  }, [api, trimmed, ownHandle, setAvailability]);
}
