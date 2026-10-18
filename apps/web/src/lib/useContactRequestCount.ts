import { Effect, Schedule } from 'effect';
import { useEffect, useState } from 'react';
import { listContactRequests } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';

/** The incoming count for the badge; null means unknown or failed, so no badge shows.
 * Refetched on focus and every 60 seconds. */
const REFRESH_MS = 60 * 1000;

/** One fetch; a failed call leaves the previous count in place. */
const refreshCount = (setCount: (count: number) => void): Effect.Effect<void> =>
  fromApi(() => listContactRequests()).pipe(
    Effect.matchEffect({
      onSuccess: (list) => Effect.sync(() => setCount(list.incoming.length)),
      onFailure: () => Effect.void,
    }),
  );

export function useContactRequestCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  // The timed loop and the focus refresh are separate runs, so a focus never cancels the loop.
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
    startLoop(Effect.repeat(refreshCount(setCount), Schedule.fixed(REFRESH_MS)));
    const onFocus = (): void => {
      refreshNow(refreshCount(setCount));
    };
    window.addEventListener('focus', onFocus);
    return () => {
      loopControls.interrupt();
      refreshControls.interrupt();
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, startLoop, refreshNow, loopControls, refreshControls]);

  return count;
}
