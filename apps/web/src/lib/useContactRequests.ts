import { Effect, Schedule } from 'effect';
import { useEffect, useState } from 'react';
import { listContactRequests, type ContactRequestView } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';

/**
 * The incoming contact requests the chat list shows as rows (T-1336), the row
 * twin of `useContactRequestCount`. Refetched on window focus and every 60
 * seconds (no realtime channel), and exposed with a `reload` so accepting a
 * request can refresh at once. A failed call leaves the previous list in place.
 */
const REFRESH_MS = 60 * 1000;

/** One fetch; a failed call leaves the previous rows in place. */
const refreshRequests = (setRequests: (rows: ContactRequestView[]) => void): Effect.Effect<void> =>
  fromApi(() => listContactRequests()).pipe(
    Effect.matchEffect({
      onSuccess: (list) => Effect.sync(() => setRequests(list.incoming)),
      onFailure: () => Effect.void,
    }),
  );

export function useContactRequests(enabled: boolean): {
  requests: ContactRequestView[];
  reload: () => void;
} {
  const [requests, setRequests] = useState<ContactRequestView[]>([]);
  // The timed loop and the focus/accept refresh are separate runs, so a focus
  // never cancels the loop (same shape as `useContactRequestCount`).
  const [, startLoop, loopControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
  );
  const [, refreshNow, refreshControls] = useAction<Effect.Effect<unknown>, unknown, never>(
    (effect) => effect,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // The first fetch runs at once, then every REFRESH_MS until interrupted.
    startLoop(Effect.repeat(refreshRequests(setRequests), Schedule.fixed(REFRESH_MS)));
    const onFocus = (): void => {
      refreshNow(refreshRequests(setRequests));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      loopControls.interrupt();
      refreshControls.interrupt();
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, startLoop, refreshNow, loopControls, refreshControls]);

  // A manual refresh after accepting: same run controls, so it never stacks
  // with itself and a later unmount interrupts it.
  const reload = (): void => {
    refreshNow(refreshRequests(setRequests));
  };

  return { requests, reload };
}
