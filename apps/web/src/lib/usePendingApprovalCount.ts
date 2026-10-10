import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { listApprovals } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';

/**
 * Returns the current count of approvals waiting for the viewer. `null` means
 * "unknown or failed" — the caller shows no badge in that case. The hook only
 * loads when `enabled` flips to `true`, so opening the menu is what triggers
 * the fetch; once loaded, a failed call leaves the previous value in place.
 *
 * The load runs as an Effect (`useAction`); the count is written from inside
 * that Effect, and an `enabled` flip back to `false` interrupts a load in flight.
 */
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
