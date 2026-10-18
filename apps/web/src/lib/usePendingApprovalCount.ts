import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { listApprovals } from '@/lib/api';
import { fromApi } from '@zilar/client-core';
import { useAction } from '@/lib/effect/use-action';

/** The approvals waiting for the viewer; null means unknown or failed, so no badge shows.
 * Loads when enabled flips true; a failed call leaves the previous value in place. */
export function usePendingApprovalCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [, load, controls] = useAction<void, void, never>(() =>
    fromApi(() => listApprovals()).pipe(
      Effect.map((list) => list.filter((approval) => approval.status === 'pending').length),
      Effect.matchEffect({
        onSuccess: (pending) => Effect.sync(() => setCount(pending)),
        // A failed call leaves the previous value; the badge just stays put.
        onFailure: () => Effect.void,
      }),
    ),
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    load();
    return () => {
      controls.interrupt();
    };
  }, [enabled, load, controls]);

  return count;
}
