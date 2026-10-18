import { Effect } from 'effect';
import { useEffect } from 'react';

import { interruptFiber } from '@zilar/client-core';
import { type ProfileApi } from '@/lib/profile-api';

import {
  handleAvailabilityFor,
  isHandleRateLimited,
  type HandleAvailability,
} from '@/components/settings/profile-logic';

const HANDLE_CHECK_DEBOUNCE_MS = 300;

type HandleCheckOptions = {
  readonly api: ProfileApi;
  readonly trimmed: string;
  readonly ownHandle: boolean;
  readonly setAvailability: (next: HandleAvailability) => void;
};

/**
 * Debounced live availability for a changed handle; a handle change interrupts
 * the fiber. Your own handle (any casing) skips the check: the server would
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
